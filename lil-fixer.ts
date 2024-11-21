import { URLSearchParams } from 'url';
import * as dotenv from 'dotenv';
import { checkbox, Separator } from '@inquirer/prompts';
import { rmSync } from 'fs';
import { TOTP } from "totp-generator"
import { execSync } from 'child_process';
import {glob} from 'glob';
import path from 'path';

dotenv.config();

const { otp, expires } = TOTP.generate(process.env.TOTP_SECRET as string);

console.log(otp);

interface Token {
    tokenType: string;
    accessToken: string;
    expiresIn: number;
    refreshToken: string;
    }

async function getToken(): Promise<Token | undefined> {
  const url = 'https://desman4.smehost.net/api/v4/oauth/token';
 

  const form = new URLSearchParams();
    form.append('client_id', process.env.AUTH_CLIENT as string);
    form.append('client_secret', process.env.AUTH_SECRET as string);
    form.append('username', process.env.AUTH_USER as string);
    form.append('password', process.env.AUTH_PASS as string);
    form.append('scope', 'full_api');
    form.append('grant_type', 'password');
    form.append('mfatoken', otp);
    

  try {

    const response = await fetch(url, {
      method: 'POST',
      body: form.toString(),
      headers: {
        'accept': 'application/json, text/plain, */*',
        'content-type': 'application/x-www-form-urlencoded',
      },
    });


    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return {
        tokenType: data.token_type,
        accessToken: data.access_token,
        expiresIn: data.expires_in,
        refreshToken: data.refresh_token,
      };
  } catch (error) {
    if (error instanceof Error) {
      console.error('Error getting token:', error.message);
    } else {
      console.error('Error getting token:', error);
    }
  }
}

getToken().then((token) => {
    if(!token) {
        throw new Error('Token is undefined');
        return;
    };

    console.log(token);

    return fetch("https://desman4.smehost.net/api/v4/projects?page=1&limit=100&filter=active", {
        "headers": {
          "accept": "application/json, text/plain, */*",
          "authorization": "Bearer " + token.accessToken,
        },
        "method": "GET"
      });


}).then((response) => {
    if (!response) {
        throw new Error('HTTP error! response is undefined');
    }
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response.json();
}).then((data) => {
    if (data.docs && data.docs.length > 0) {
      const projects = data.docs
      .sort((a: any, b: any) => a.id.localeCompare(b.id))
      .map((project: any) => ({
        id: project.id,
        name: project.name,
        value: project.id,
        updatedAt: project.updatedAt
      }));

      const choices = projects.map((project: any) => ({
        name: `${project.id} - ${project.name} (Updated At: ${project.updatedAt})`,
        value: project.id
      }));

      checkbox({
        message: 'Select projects to scan:',
        choices: choices
      }).then((value: unknown[]) => {
        const selectedProjectIds = value as string[];
        selectedProjectIds.forEach(async (projectId: string) => {
          console.log(`Scanning project: ${projectId}`);
          await gitScan(projectId);
        });
      }).catch((error: any) => {
        console.error('Error selecting projects:', error);
      });
    }
    
}).catch((error) => {
    console.error('Error getting projects:', error);
});

const gitScan = async function(projectId: string) {
    const repoUrl = `git@gitlab.smehost.net:desmanv4-managed/${projectId}.git`;
    const cloneDir = `./${projectId}`;

    console.log(`Cloning ${repoUrl} to ${cloneDir}`);


    try {
      rmSync(cloneDir, { recursive: true, force: true });
      execSync(`git clone -b devel ${repoUrl} ${cloneDir}`, { stdio: 'inherit' });
      console.log('Git clone complete');

      //glob directory for package.json
      // and run npm audit fix

      const files = await glob(`${cloneDir}/**/package.json`);
      for (const file of files) {
        const dir = path.dirname(file);
        console.log(`Running npm audit fix in ${dir}`);
        try {
          execSync(`npm audit fix`, { cwd: dir, stdio: 'inherit' });
        } catch (error) {
          console.error(`Error running npm audit fix in ${dir}:`, error);
        }
        console.log('npm audit fix complete');
      }

      execSync(`git commit -a -m "auto security audit"`, { cwd: cloneDir, stdio: 'inherit' });
      execSync(`git push`, { cwd: cloneDir, stdio: 'inherit' });
    } catch (error) {
      if (error instanceof Error) {
        console.error(`Error: ${error.message}`);
      } else {
        console.error('Unknown error:', error);
      }
    }

    console.log('done');
    return;
}

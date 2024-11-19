import { URLSearchParams } from 'url';
import * as dotenv from 'dotenv';


import { TOTP } from "totp-generator"
import { exec } from 'child_process';
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

    return fetch("https://desman4.smehost.net/api/v4/projects?page=1&limit=1&filter=active", {
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
        const project = data.docs[0];
        console.log(`Project Name: ${project.name}`);
        console.log(`Project ID: ${project.id}`);
        console.log(`Updated At: ${project.updatedAt}`);
        gitScan(project.id);
    }
    
}).catch((error) => {
    console.error('Error getting projects:', error);
});

const gitScan = function(projectId: string) {
    const repoUrl = `git@gitlab.smehost.net:desmanv4-managed/${projectId}.git`;
    const cloneDir = `./${projectId}`;

    console.log(`Cloning ${repoUrl} to ${cloneDir}`);
    const git = exec(`git clone ${repoUrl} ${cloneDir}`, (error, stdout, stderr) => {
        if (error) {
            console.error(`Error cloning repository: ${error.message}`);
            return;
        }
        console.log('Git clone complete');
        
        //glob directory for package.json
        // and run npm audit fix

        glob(`${cloneDir}/**/package.json`).then((files) => {
            files.forEach((file) => {
                const dir = path.dirname(file);
                console.log(`Running npm audit fix in ${dir}`);
                const npm = exec(`npm audit fix`, {cwd: dir}, (error, stdout, stderr) => {
                    if (error) {
                        console.error(`Error running npm audit fix: ${error.message}`);
                        return;
                    }
                    console.log('npm audit fix complete');
                });
            });
        });

    });
}

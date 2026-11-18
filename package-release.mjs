import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const version=JSON.parse(fs.readFileSync('package.json','utf8')).version;
if(!/^\d+\.\d+\.\d+$/.test(version))throw Error('Invalid release version');
const release=path.resolve('dist/release'),archive=path.resolve('dist/clinical-anatomy-3d-'+version+'.zip');
if(!fs.existsSync(release+'/plugin-installer.sql'))throw Error('Run the build first');
let result;
if(process.platform==='win32'){
 const quote=value=>"'"+value.replaceAll("'","''")+"'";
 const command="& ([scriptblock]::Create([IO.File]::ReadAllText("+quote(path.resolve('package-release.ps1'))+"))) -Version "+quote(version)+" -ProjectPath "+quote(process.cwd());
 result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{encoding:'utf8'});
}else{
 if(fs.existsSync(archive))fs.unlinkSync(archive);
 result=spawnSync('zip',['-qr',archive,'.'],{cwd:release,encoding:'utf8'});
}
if(result.status!==0)throw Error(result.stderr||result.stdout||'ZIP creation failed');
const digest=createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
fs.writeFileSync(archive+'.sha256',digest+'  '+path.basename(archive)+'\n');
console.log('Created '+archive+' ('+fs.statSync(archive).size+' bytes); SHA-256 '+digest);

import fs from 'node:fs';
import path from 'node:path';
const root=fs.realpathSync(path.resolve('qa'));
const target=path.resolve(root,'out');
if(path.dirname(target)!==root || path.basename(target)!=='out')throw Error('Unexpected QA output path');
if(fs.existsSync(target)){
    if(fs.realpathSync(target)!==target || fs.lstatSync(target).isSymbolicLink())throw Error('Refusing linked QA output');
    fs.rmSync(target,{recursive:true,force:true});
}
fs.mkdirSync(target,{recursive:true});
console.log('Cleared generated QA output. Source fixtures are preserved.');

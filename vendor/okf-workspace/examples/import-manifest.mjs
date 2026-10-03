import fs from 'node:fs/promises';
import {CatalogWorkspace} from '../dist/index.js';
const [state,file,mappingFile,key]=process.argv.slice(2);
if(!key)throw new Error('Usage: node examples/import-manifest.mjs STATE MANIFEST.json MAPPING.json IDEMPOTENCY_KEY');
const w=new CatalogWorkspace(state);
console.log(JSON.stringify({base_snapshot:await w.current(),idempotency_key:key,manifest:JSON.parse(await fs.readFile(file,'utf8')),mapping:JSON.parse(await fs.readFile(mappingFile,'utf8'))},null,2));

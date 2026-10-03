import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { SFACE_TEMPLATE, transformFacePoint } from '../features/album/face-alignment.ts';
import { prepareFaceModel } from './prepare-face-model.mjs';

const root = resolve(import.meta.dirname, '..');
const reports = resolve(root, '.expo/face-engine-verification');
const python = process.env.AOI_FACE_REFERENCE_PYTHON ?? resolve(root, '.expo/face-reference-venv/bin/python');
const target = process.env.AOI_PHONE_TARGET ?? 'com.ekasc.aoi.dev';
const run = (command, args) => {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', timeout: 120_000 });
  if (result.error || result.status !== 0) throw new Error(result.error?.message ?? result.stderr ?? 'Phone face check failed');
  return result.stdout;
};
const evaluate = (expression) => JSON.parse(run(process.execPath, ['scripts/dev-agent.mjs', 'eval', expression, '--target', target, '--timeout', '15000']));

await prepareFaceModel(true);
await mkdir(reports, { recursive: true });
const directory = await mkdtemp(resolve(reports, 'phone-run-'));
const cases = [
  { name: 'identity', source: { a: 1, b: 0, tx: 0, ty: 0 } },
  { name: 'tilted', source: { a: 1.15, b: 0.3, tx: 40, ty: 10 } },
].map(({ name, source }) => ({ name, points: SFACE_TEMPLATE.map((point) => transformFacePoint(point, source)) }));
try {
  await writeFile(resolve(directory, 'cases.json'), JSON.stringify(cases));
  run(python, ['scripts/face-reference.py', 'fixtures', directory]);
  run(python, ['scripts/face-reference.py', 'phone-reference', directory]);
  const png = (await readFile(resolve(directory, 'synthetic.png'))).toString('base64');
  const expected = JSON.parse(await readFile(resolve(directory, 'phone-reference.json'), 'utf8'));
  const request = JSON.stringify({ png, cases, file: `aoi-synthetic-face-check-${Date.now()}.png` });
  evaluate(`(function(){
    if(globalThis.__aoiFaceReferenceProbe)throw new Error('Another face check is active');
    var modules=globalThis.__r.getModules(),fs,recognition;
    modules.forEach(function(m){
      if(m.verboseName==='features/album/local-face-recognition.native.ts')recognition=m.publicModule.exports;
      if(m.verboseName&&m.verboseName.indexOf('expo-file-system')!==-1&&m.verboseName.endsWith('/src/index.ts'))fs=m.publicModule.exports;
    });
    if(!fs||!recognition)throw new Error('Open the real Us screen on the phone first');
    var request=${request};
    globalThis.__aoiFaceReferenceProbe={pending:true};
    (async function(){
      var file=new fs.File(fs.Paths.cache,request.file),engine=recognition.createLocalFaceRecognition(),outcome;
      try{
        var binary=atob(request.png),bytes=new Uint8Array(binary.length);
        for(var i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
        file.write(bytes);
        if(!await engine.isAvailable())throw new Error('Phone recognition is unavailable');
        var faces=await engine.detect(file.uri),outputs=[];
        for(var j=0;j<request.cases.length;j++){
          var item=request.cases[j];
          var embedding=await engine.embed(file.uri,{x:0,y:0,width:112,height:112,rollAngle:0,landmarks:item.points});
          outputs.push({case:item.name,embedding:Array.from(embedding)});
        }
        outcome={pending:false,detectedFaces:faces.length,outputs:outputs};
      }catch(e){outcome={pending:false,error:String(e.message)}}
      finally{
        try{if(file.exists)file.delete();await engine.dispose();outcome.scratchRemoved=!file.exists}
        catch(e){outcome={pending:false,error:'Synthetic check cleanup failed'}}
      }
      globalThis.__aoiFaceReferenceProbe=outcome;
    })();
    return {started:true};
  })()`);
  const deadline = Date.now() + 60_000;
  let result;
  do {
    await new Promise((resolve) => setTimeout(resolve, 500));
    result = evaluate('globalThis.__aoiFaceReferenceProbe');
  } while (result.pending && Date.now() < deadline);
  if (result.pending || result.error) throw new Error(result.error ?? 'Phone inference timed out');
  if (result.detectedFaces !== 0 || result.outputs?.length !== expected.length || result.scratchRemoved !== true) throw new Error('Unexpected synthetic fixture result or incomplete cleanup');
  const comparisons = expected.map((reference, index) => {
    const actual = result.outputs[index];
    if (actual.case !== reference.case || actual.embedding.length !== 128 || !actual.embedding.every(Number.isFinite)) throw new Error('Invalid phone embedding');
    const norm = Math.hypot(...actual.embedding);
    const cosine = actual.embedding.reduce((sum, value, i) => sum + value * reference.embedding[i], 0) / (norm * Math.hypot(...reference.embedding));
    const maxError = Math.max(...actual.embedding.map((value, i) => Math.abs(value - reference.embedding[i])));
    if (cosine < 0.9999 || maxError > 0.001 || Math.abs(norm - 1) > 0.0001) throw new Error(`Phone/reference disagreement in ${reference.case}`);
    return { case: reference.case, cosine, maxError };
  });
  const report = { target, detectedFaces: result.detectedFaces, comparisons, syntheticOnly: true, scratchRemoved: result.scratchRemoved };
  await writeFile(resolve(reports, 'phone-results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  try { evaluate('delete globalThis.__aoiFaceReferenceProbe'); } catch { /* A disconnected phone cannot be inspected; its native job still owns cleanup. */ }
  await rm(directory, { recursive: true, force: true });
}

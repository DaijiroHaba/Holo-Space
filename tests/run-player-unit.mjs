import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const files=['gestures.test.mjs','v08-flow.test.mjs','v10-handoff.test.mjs','v11-routing.test.mjs','player-legacy-unit.test.mjs','v16-init.test.mjs','player-input.test.mjs','player-auto.test.mjs','player-pose-source.test.mjs'];
const result=spawnSync(process.execPath,['--test',...files.map(n=>'tests/'+n)],{cwd:fileURLToPath(new URL('..',import.meta.url)),stdio:'inherit'});process.exitCode=result.status??1;

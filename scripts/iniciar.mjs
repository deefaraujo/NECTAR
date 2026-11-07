// Abre o app em modo de desenvolvimento (npm start).
// Terminais do VS Code exportam ELECTRON_RUN_AS_NODE=1; com ele o Electron roda como Node puro,
// sem janela, e morre com "Cannot read properties of undefined (reading 'whenReady')".
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const electron = require('electron');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const proc = spawn(electron, [path.resolve(import.meta.dirname, '..')], { stdio: 'inherit', env });
proc.on('close', (codigo) => process.exit(codigo ?? 0));

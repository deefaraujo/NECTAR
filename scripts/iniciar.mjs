// Opens the app in development mode (npm start).
// VS Code terminals export ELECTRON_RUN_AS_NODE=1; with it Electron runs as plain Node,
// without a window, and dies with "Cannot read properties of undefined (reading 'whenReady')".
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const electron = require('electron');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const proc = spawn(electron, [path.resolve(import.meta.dirname, '..')], { stdio: 'inherit', env });
proc.on('close', (codigo) => process.exit(codigo ?? 0));

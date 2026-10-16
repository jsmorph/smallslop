import { runRepairDemo } from './repair.js';
import { readPackageSync } from '../server/source-files.mjs';

for (const state of runRepairDemo(readPackageSync('kernel')).states) console.log(state);

/*
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import fs from 'fs-extra';
import globby from 'globby';
import nodeResolve from '@rollup/plugin-node-resolve';
import replace from '@rollup/plugin-replace';
import cssnano from 'cssnano';
import postcss from 'postcss';
import atImport from 'postcss-import';
import {terser} from 'rollup-plugin-terser';


const compileCSS = async (srcPath) => {
  const css = await fs.readFile(srcPath, 'utf-8');
  const plugins = [atImport()];
  if (process.env.NODE_ENV === 'production') {
    plugins.push(cssnano({preset: ['default', {
      discardComments: {removeAll: true},
    }]}));
  }

  const result = await postcss(plugins).process(css, {from: srcPath});
  return result.css;
};

function buildCSS() {
  return {
    name: 'built-css',
    async buildStart() {
      const srcFiles = await globby('./src/**/*.css');
      for (const file of srcFiles) {
        this.addWatchFile(file);
      }
    },
    async generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'main.css',
        source: await compileCSS('./src/main.css'),
      });
    },
  };
}

function buildHTML() {
  return {
    name: 'build-html',
    buildStart() {
      this.addWatchFile('./src/index.html');
    },
    async generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'index.html',
        source: await fs.readFile('./src/index.html', 'utf-8'),
      });
    },
  };
}

const plugins = [
  nodeResolve(),
  buildCSS(),
  buildHTML(),
  replace({
    '__ENV__': JSON.stringify(process.env.NODE_ENV),
  }),
];
if (process.env.NODE_ENV === 'production') {
  plugins.push(terser({
    mangle: {module: true},
    format: {
      comments: false,
    },
  }));
}

export default {
  input: 'src/main.js',
  plugins,
  output: {
    file: 'public/main.js',
    sourcemap: true,
    format: 'es',
  },
  watch: {
    clearScreen: false,
  },
};

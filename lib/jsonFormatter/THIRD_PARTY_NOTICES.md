# Third-party notice: JSON Formatter

Linchpin's JSON formatter adapts runtime behavior, interaction patterns, and visual conventions from Callum Locke's **JSON Formatter**:

- Upstream: https://github.com/callumlocke/json-formatter
- Branch reviewed: `master`
- Commit: `bfd63560efe2c91c899a68c49bc8eedf5a43a101`
- Retrieved/reviewed: 2026-07-19
- License: BSD 3-Clause

The adapted Linchpin files are `detect.ts`, `parse.ts`, `render.ts`, and `styles.ts` in this directory. Linchpin does not copy the upstream build. This was a one-time pull. The runtime was ported to strict TypeScript and WXT; DOM output uses safe construction/text nodes; branches materialize lazily; controls use one delegated listener; input is capped at 10 MB; unsafe integer tokens are warned about; themes use CSS custom properties; and the formatter installs no observer after mounting.

## BSD 3-Clause License

Copyright (c) 2023, Callum Locke

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS “AS IS” AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

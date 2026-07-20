Perhaps we could improve on this extendsion by making it my "All in One" so I can remove more extensions. Figure out a good name for this new version.

I want to imlplement some of the features of: https://github.com/levelsio/superlevels

Mainly:

- JSON Formatter is encoding is JSON. Can be modelled after https://github.com/callumlocke/json-formatter which I use right now.
- Add back the GOogle Maps button. I currently use https://chromewebstore.google.com/detail/google-search-maps-button/edllcgchknhokighleffpipdedmpgiln but Superlevels has this too
- Superlevels AI summarizer for a tab. Should work with OpenAI, Anthropic, xAI, Kimi, Gemini, GLM
- Superlevels "View Image" and "Pic in Picture" equivalents
- Youtube: This should live behind toggle flags but: Remove Shorts

Dont just copy their existing code. Make new nice Typescript. My main concerns are high CPU performance (low footprint) and low RAM usage. especially ram usage over long time as I keep browser open for days and days.

Generate nice app icons for this too. Use them in the extension configs etc.

We can put each major feature either in its own subfolder or its own .ts file. The Reddit stuff can have a subfolder of its own I guess.

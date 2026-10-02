# Discovery Lab at UCSF

Website: https://discolab.org/

The site is published from `index.html` on the `main` branch using GitHub Pages. Edit that file and commit to `main` to update the website.

The homepage styles are inline; cellular-automaton interaction lives in `simulation.js`. Google Fonts supplies Space Grotesk. Icons, the sharing image, and the custom error page are local static assets.

The board starts after three seconds unless reduced motion is selected or the visitor interacts with the demo. Explicit Play opts into motion. Draw enables pointer editing; outside drawing mode, scrolling and pinch zoom remain available. Arrow keys select a cell and Space toggles it. Step advances one generation, Glider restores Conway's rules, and Reseed retains the chosen rules. Clear, editing, presets, and reseeding pause playback. The logical board persists when resized; playback suspends while hidden or offscreen.

Launch checks: narrow/zoomed layouts, keyboard editing, reduced motion before and during playback, theme switching with storage blocked, resize preservation, font delivery, social/image assets, and an unknown path returning the branded page with HTTP 404. Real iOS Safari, Android Chrome, and screen-reader checks remain useful.

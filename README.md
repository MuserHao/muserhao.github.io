# muserhao.github.io

Personal website and tech blog for Hao Xin -- Senior Machine Learning Engineer at Zoox.

**Live site:** [muserhao.github.io](https://muserhao.github.io/)

## What's here

- **Portfolio** -- About, journey (experience + education), research, and contact
- **Blog** -- Tech blog with KaTeX math rendering, tag filtering, and code highlighting
- **Fun Lab** -- In-browser RL experiments (Pong, Lunar Lander) you can watch learn in real time
- **Two themes** -- Dark "Observatory" and light "Atelier", toggled from the nav and remembered per visitor

## Structure

```
index.html          # Main portfolio page
style.css           # Global styles, both themes
shared.js           # Theme toggle, nav, and shared page behavior
generative-bg.js    # Hero generative flow-field background
neural-net.js       # Three.js neural-net visual
blog/
  index.html        # Blog listing page with tag filters
  blog.css          # Blog-specific styles
  posts/*.html      # Individual blog posts
lab/                # Interactive RL experiments
tests/              # HTML validation test (run in CI)
sitemap.xml         # Keep in sync when adding pages
```

## Adding a new blog post

1. Create a new `.html` file in `blog/posts/` (copy an existing post as a template)
2. Add KaTeX to the `<head>` for math support -- use `$...$` for inline and `$$...$$` for display math
3. Add a card entry in `blog/index.html` (the homepage preview is loaded from it automatically)
4. Add the post to `sitemap.xml`
5. Commit and push to `main` -- the site updates automatically via GitHub Pages

## Running tests

```
python -m unittest discover -s tests -v
```

## Tech stack

- Plain HTML/CSS/JS (no build tools, no frameworks)
- [KaTeX](https://katex.org/) for LaTeX math rendering
- [Three.js](https://threejs.org/) for the hero visual
- [Font Awesome](https://fontawesome.com/) for icons
- [Google Fonts](https://fonts.google.com/)
- GitHub Pages for hosting

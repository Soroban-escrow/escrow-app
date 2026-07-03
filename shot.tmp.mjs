import { chromium } from '@playwright/test';
const out = process.argv[2];
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1200, height: 680 } });
await p.setContent(`<body style="margin:0;display:grid;gap:12px;background:#888">
<img src="file://${process.cwd()}/docs/img/banner-light.svg" width="1200">
<img src="file://${process.cwd()}/docs/img/banner-dark.svg" width="1200"></body>`);
await p.waitForTimeout(500);
await p.screenshot({ path: `${out}/banners.png`, fullPage: true });
await b.close();

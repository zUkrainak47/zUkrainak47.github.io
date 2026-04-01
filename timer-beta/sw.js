const APP_CACHE_NAME = 'ukratimer-app-v2';
const RUNTIME_CACHE_NAME = 'ukratimer-runtime-v2';

const GOOGLE_FONTS_STYLESHEET_URL = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&family=Roboto+Mono:wght@400;500;700&display=swap';
const CUBING_SCRAMBLE_MODULE_URL = 'https://cdn.cubing.net/v0/js/cubing/scramble';
const SCRAMBOW_SCRIPT_URL = 'https://unpkg.com/scrambow@1.8.1/dist/scrambow.js';

const LOCAL_PRECACHE_PATHS = [
    './',
    './index.html',
    './manifest.webmanifest',
    './css/variables.css?v=6',
    './css/base.css?v=17',
    './css/layout.css?v=15',
    './css/scramble.css?v=37',
    './css/timer.css?v=31',
    './css/stats.css?v=19',
    './css/cube.css?v=7',
    './css/graph.css?v=9',
    './css/modal.css?v=15',
    './css/settings.css?v=10',
    './js/app.js?v=101',
    './js/timer.js?v=7',
    './js/scramble.js?v=16',
    './js/session.js?v=2',
    './js/settings.js?v=2',
    './js/stats.js?v=2',
    './js/modal.js?v=13',
    './js/cube-display.js?v=18',
    './js/graph.js?v=11',
    './js/utils.js',
    './js/storage.js',
    './js/db.js',
    './js/distribution.js',
    './resources/comment.svg',
    './resources/comment-off.svg',
    './resources/calendar-date.svg',
    './resources/calendar-date-off.svg',
    './resources/clock.svg',
    './resources/legend.svg',
    './resources/hashtag.svg',
    './resources/hashtag-full.svg',
    './resources/settings.svg',
    './resources/distribution.svg',
    './resources/pwa-icon.svg',
    './resources/pwa-icon-192.png',
    './resources/pwa-icon-512.png',
    './resources/pwa-icon-180.png',
];

const EXTERNAL_PRECACHE_REQUESTS = [
    new Request(CUBING_SCRAMBLE_MODULE_URL, { mode: 'cors' }),
    new Request(SCRAMBOW_SCRIPT_URL, { mode: 'no-cors' }),
];

const EXTERNAL_RUNTIME_HOSTS = new Set([
    'fonts.googleapis.com',
    'fonts.gstatic.com',
    'cdn.cubing.net',
    'unpkg.com',
]);

function resolveLocalUrl(path) {
    return new URL(path, self.location).toString();
}

function isCacheableResponse(response) {
    return Boolean(response) && (response.ok || response.type === 'opaque');
}

async function addLocalAssetsToCache(cache) {
    await cache.addAll(LOCAL_PRECACHE_PATHS);
}

async function addExternalAssetsToCache(cache) {
    try {
        const stylesheetRequest = new Request(GOOGLE_FONTS_STYLESHEET_URL, { mode: 'cors' });
        const stylesheetResponse = await fetch(stylesheetRequest);

        if (isCacheableResponse(stylesheetResponse)) {
            await cache.put(stylesheetRequest, stylesheetResponse.clone());

            const stylesheetText = await stylesheetResponse.clone().text();
            const fontUrls = Array.from(
                stylesheetText.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g),
                (match) => match[1],
            );

            await Promise.allSettled(
                fontUrls.map(async (fontUrl) => {
                    const fontRequest = new Request(fontUrl, { mode: 'cors' });
                    const fontResponse = await fetch(fontRequest);
                    if (isCacheableResponse(fontResponse)) {
                        await cache.put(fontRequest, fontResponse.clone());
                    }
                }),
            );
        }
    } catch (_) {
        // Font caching is optional; the app remains usable with fallback fonts.
    }

    await Promise.allSettled(
        EXTERNAL_PRECACHE_REQUESTS.map(async (request) => {
            const response = await fetch(request);
            if (isCacheableResponse(response)) {
                await cache.put(request, response.clone());
            }
        }),
    );
}

async function networkFirstNavigation(request) {
    const cache = await caches.open(APP_CACHE_NAME);

    try {
        const response = await fetch(request);
        if (isCacheableResponse(response)) {
            await cache.put(request, response.clone());
        }
        return response;
    } catch (error) {
        return (
            await caches.match(request)
            || await caches.match(resolveLocalUrl('./'))
            || await caches.match(resolveLocalUrl('./index.html'))
        );
    }
}

async function cacheFirst(request, cacheName) {
    const cached = await caches.match(request);
    if (cached) {
        return cached;
    }

    const response = await fetch(request);
    if (isCacheableResponse(response)) {
        const cache = await caches.open(cacheName);
        await cache.put(request, response.clone());
    }
    return response;
}

async function staleWhileRevalidate(request, cacheName) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);

    const networkPromise = fetch(request)
        .then(async (response) => {
            if (isCacheableResponse(response)) {
                await cache.put(request, response.clone());
            }
            return response;
        })
        .catch(() => null);

    if (cached) {
        void networkPromise;
        return cached;
    }

    const response = await networkPromise;
    if (response) return response;

    throw new Error(`Unable to satisfy request for ${request.url}`);
}

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(APP_CACHE_NAME);
        await addLocalAssetsToCache(cache);
        await addExternalAssetsToCache(cache);
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const cacheNames = await caches.keys();
        await Promise.all(
            cacheNames
                .filter((name) => name !== APP_CACHE_NAME && name !== RUNTIME_CACHE_NAME)
                .map((name) => caches.delete(name)),
        );
        await self.clients.claim();
    })());
});

self.addEventListener('message', (event) => {
    if (event.data?.type === 'SKIP_WAITING') {
        void self.skipWaiting();
    }
});

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);

    if (request.mode === 'navigate') {
        event.respondWith(networkFirstNavigation(request));
        return;
    }

    if (url.origin === self.location.origin) {
        event.respondWith(cacheFirst(request, APP_CACHE_NAME));
        return;
    }

    if (EXTERNAL_RUNTIME_HOSTS.has(url.hostname)) {
        event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE_NAME));
    }
});

'use strict';

import { Log } from '../Log.js';
import { HttpRequest } from './HttpRequest.js';
import { HttpResponse } from './HttpResponse.js';
import { HttpRequestLogger } from './HttpRequestLogger.js';

import * as http from 'http';
import * as fs from 'fs';
import * as nodePath from 'path';
import * as nodeUrl from 'url';

export class HttpStaticServer {

    constructor() {

        this.server = http.createServer({
            IncomingMessage: HttpRequest,
            ServerResponse: HttpResponse
        }, this.onRequest.bind(this));

        this.staticDirectories = {};
        this.pages = [];
        this.proxyTarget = null;
    }

    /*
    **
    **
    */
    async onRequest(request, response) {

        request.decomposeUrl();

        const path = request.builtUrl.pathname;

        // Proxy /api/* to the backend
        if (this.proxyTarget && path.startsWith('/api')) {
            this.proxyRequest(request, response, path);
            return;
        }

        if (request.method !== 'GET')
            return;

        new HttpRequestLogger(request, response);

        if (this.lookForPage(path, response))
            return;

        else if (!this.lookForStaticFile(path, response)) {

            response.writeHead(404);
            response.end('not found', 'utf-8');
        }
    }

    /*
    **
    **
    */
    proxyRequest(request, response, path) {

        const target = nodeUrl.parse(this.proxyTarget);

        const options = {
            hostname: target.hostname,
            port:     target.port || 80,
            path:     path + (request.builtUrl.search || ''),
            method:   request.method,
            headers:  { ...request.headers, host: target.host }
        };

        const proxy = http.request(options, (proxyResponse) => {
            response.writeHead(proxyResponse.statusCode, proxyResponse.headers);
            proxyResponse.pipe(response, { end: true });
        });

        proxy.on('error', () => {
            response.writeHead(502);
            response.end('backend unavailable');
        });

        request.pipe(proxy, { end: true });
    }

    /*
    **
    **
    */
    setProxy(target) {

        this.proxyTarget = target;
    }

    /*
    **
    **
    */
    lookForStaticFile(path, response) {

        for (let directoryPath in this.staticDirectories) {

            if (!Array.isArray(this.staticDirectories[directoryPath]))
                continue;

            for (let file of this.staticDirectories[directoryPath]) {

                if (file.path === path) {

                    if (!file.content)
                        file.content = fs.readFileSync(file.filePath);

                    response.writeHead(200, {
                        'Content-Type': file.mime,
                        'Content-Length': file.content.byteLength
                    });

                    response.end(file.content, 'utf-8');

                    return true;
                }
            }
        }

        return false;
    }

    /*
    **
    **
    */
    lookForPage(path, response) {

        for (let page of this.pages) {

            if (page.path === path) {

                if (page.redirection)
                    this.redirect(response, page.redirection);
                else {
                    
                    response.writeHead(200, {
                        'Content-Type': 'text/html',
                        'Content-Length': page.content.byteLength
                    });

                    response.end(page.content, 'utf-8');
                }

                return true;
            }
        }

        return false;
    }

    /*
    **
    **
    */
    getMime(extname) {

        return {
            '.html': 'text/html',
            '.js':   'text/javascript',
            '.mjs':  'text/javascript',
            '.css':  'text/css',
            '.png':  'image/png',
            '.jpg':  'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif':  'image/gif',
            '.svg':  'image/svg+xml',
            '.ico':  'image/x-icon',
            '.woff':  'font/woff',
            '.woff2': 'font/woff2',
            '.eot':   'application/vnd.ms-fontobject',
            '.otf':   'font/otf',
            '.ttf':   'font/ttf',
            '.sf2':   'application/octet-stream',
            '.sf3':   'application/octet-stream',
            '.json':  'application/json',
            '.txt':   'text/plain',
        }[extname];
    }

    /*
    **
    **
    */
    aspireDirectory(
        directoryPath, 
        memoryLimit,
        memoryLimitPerFile,
        files = [], 
        cachedSize = 0,
        treePosition = '/') {
        
        if (!fs.existsSync(directoryPath) || !fs.lstatSync(directoryPath).isDirectory())
            return;

        for (let entryName of fs.readdirSync(directoryPath)) {
            
            let entryPath = nodePath.resolve(directoryPath, entryName);
            let entryStat = fs.lstatSync(entryPath);

            if (entryStat.isFile()) {

                let mime = this.getMime(nodePath.extname(entryName));
                
                if (!mime)
                    continue;

                let content = null;

                if (cachedSize + entryStat.size < memoryLimit && entryStat.size < memoryLimitPerFile) {
                    content = fs.readFileSync(entryPath);
                    cachedSize += entryStat.size;
                }

                if (entryName === 'index.html')
                    entryName = '';

                files.push({
                    path: `${treePosition}${entryName}`,
                    filePath: entryPath,
                    mime: mime,
                    content: content
                });
            }
            else if (entryStat.isDirectory()) {

                this.aspireDirectory(
                    entryPath, 
                    memoryLimit,
                    memoryLimitPerFile,
                    files, 
                    cachedSize,
                    `${treePosition}${entryName}/`);
            }
        }

        return files;
    }

    /*
    **
    **
    */
    addStatics(
        directoryPath, 
        memoryLimit = 1000 * 1000 * 1000 * 10 /*10GB*/,
        memoryLimitPerFile = 1000 * 1000 * 5 * 10 /*50MB*/) {

        let data = this.aspireDirectory(directoryPath, memoryLimit, memoryLimitPerFile);

        this.staticDirectories[directoryPath] = data;
    }

    /*
    **
    **
    */
    clearStatics() {

        this.staticDirectories = [];
    }

    /*
    **
    **
    */
    addPages(pages, directoryPath) {

        let index = `${directoryPath}/index.html`;

        if (!fs.existsSync(index) || !fs.lstatSync(index).isFile())
            return;

        index = fs.readFileSync(index).toString();

        for (let page of pages) {
            
            if (typeof page.path !== 'string')
                continue;
            
            if (typeof page.redirection === 'string') {
                this.pages.push({
                    path: page.path,
                    redirection: page.redirection
                });
                continue;
            }

            let html = index;

            for (let key in page)
                html = html.replace(new RegExp(`{${key}}`, 'g'), page[key]);

            let buffer = Buffer.from(html);

            this.pages.push({
                path: page.path,
                content: buffer
            });
        }
    }

    /*
    **
    **
    */
    clearPages() {

        this.pages = [];
    }

    /*
    **
    **
    */
    listen(data, callback) {

        this.server.listen(data.port, data.host, callback);
    }

    /*
    **
    **
    */
    async close(callback) {

        if (!this.server || !this.server.listening)
            return;

        await new Promise(function(resolve) {
            this.server.close(resolve);
        }.bind(this));

        callback();
    }
}
#!/usr/bin/env python3
"""A stand-in for totaljerkface.com on the PC test build, for runs without the internet:
   python3 scripts/net-mock.py <folder of saved answers> [port] [mirror folder]
   H5_NET_MAP="https://totaljerkface.com/=http://127.0.0.1:18081/" bash scripts/run-host.sh ...
The folder holds answers saved from the real site: get_featured.xml, get_record.bin, config.json. The mirror
folder holds the site's files at their paths (happy-wheels-js/version.json, .../js/..., .../assets-.../...);
a GET it lacks is answered 404 and logged as "mock: MISS <path>" (fetch those from the site and run again)."""
import http.server
import os
import sys
import urllib.parse

FOLDER = sys.argv[1]
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 18081
MIRROR = sys.argv[3] if len(sys.argv) > 3 else None
TYPES = {'.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
         '.css': 'text/css', '.otf': 'font/otf', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.mp4': 'video/mp4', '.txt': 'text/plain'}


class Handler(http.server.BaseHTTPRequestHandler):
    def send_file(self, name, ctype, folder=None):
        path = os.path.join(folder or FOLDER, name)
        if not os.path.isfile(path):
            self.send_response(404)
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        data = open(path, 'rb').read()
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        print('mock: GET', self.path, flush=True)
        if self.path.startswith('/hw-steam/config.json'):
            return self.send_file('config.json', 'application/json')
        rel = urllib.parse.unquote(self.path.split('?')[0]).lstrip('/')
        if MIRROR and '..' not in rel.split('/'):
            if os.path.isfile(os.path.join(MIRROR, rel)):
                return self.send_file(rel, TYPES.get(os.path.splitext(rel)[1], 'application/octet-stream'), MIRROR)
            print('mock: MISS /' + rel, flush=True)
        self.send_file('-', 'text/plain')

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get('Content-Length') or 0)).decode('utf-8', 'replace')
        action = urllib.parse.parse_qs(body).get('action', [''])[0]
        print('mock: POST', self.path, 'action=' + action, '|', self.headers.get('Content-Type'), '|', body[:400], flush=True)
        if action == 'get_featured':
            return self.send_file('get_featured.xml', 'text/xml;charset=ISO-8859-1')
        if action == 'get_record':
            return self.send_file('get_record.bin', 'application/octet-stream')
        if action and os.path.isfile(os.path.join(FOLDER, action + '.bin')):   # (any other: <action>.bin)
            return self.send_file(action + '.bin', 'text/xml;charset=ISO-8859-1')
        self.send_response(200)
        self.send_header('Content-Length', '0')
        self.end_headers()

    def log_message(self, *args):
        pass


http.server.ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()

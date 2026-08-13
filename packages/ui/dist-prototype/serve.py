"""SPA server — serves index.html for all routes (client-side routing fallback)."""
import http.server
import os

PORT = 9999
DIR = os.path.dirname(os.path.abspath(__file__))

class SPAHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIR, **kwargs)

    def do_GET(self):
        path = self.translate_path(self.path)
        if os.path.isfile(path):
            return super().do_GET()
        self.path = "/index.html"
        return super().do_GET()

if __name__ == "__main__":
    with http.server.HTTPServer(("", PORT), SPAHandler) as srv:
        print(f"Prototype running at http://localhost:{PORT}")
        print("Press Ctrl+C to stop.")
        srv.serve_forever()

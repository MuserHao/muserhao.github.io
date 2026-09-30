import unittest
from html.parser import HTMLParser
import os

class HTMLValidator(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags = []
        self.errors = []
        self.has_doctype = False
        self.has_title = False
        self.void_tags = {
            'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
            'link', 'meta', 'param', 'source', 'track', 'wbr'
        }

    def handle_decl(self, decl):
        if decl.lower() == 'doctype html':
            self.has_doctype = True

    def handle_starttag(self, tag, attrs):
        if tag == 'title':
            self.has_title = True
        if tag not in self.void_tags:
            self.tags.append(tag)

    def handle_endtag(self, tag):
        if tag in self.void_tags:
            return

        if not self.tags:
            self.errors.append(f"Unexpected closing tag </{tag}>")
        elif self.tags[-1] == tag:
            self.tags.pop()
        else:
            if tag in self.tags:
                while self.tags and self.tags[-1] != tag:
                    self.errors.append(f"Missing closing tag for <{self.tags.pop()}>")
                self.tags.pop()
            else:
                self.errors.append(f"Unexpected closing tag </{tag}>")

    def validate(self, html):
        self.feed(html)
        if not self.has_doctype:
            self.errors.append("Missing <!DOCTYPE html>")
        if not self.has_title:
            self.errors.append("Missing <title> element")
        for tag in reversed(self.tags):
            self.errors.append(f"Missing closing tag for <{tag}>")
        return self.errors

class TestHTMLValidation(unittest.TestCase):
    def test_index_html_validity(self):
        # Ensure we are checking the correct file path relative to the repo root
        file_path = os.path.join(os.path.dirname(__file__), '..', 'index.html')
        with open(file_path, 'r') as f:
            html = f.read()

        validator = HTMLValidator()
        errors = validator.validate(html)

        self.assertEqual(errors, [], f"HTML validation errors found: {', '.join(errors)}")

    def test_all_pages_validity(self):
        root = os.path.join(os.path.dirname(__file__), '..')
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if not d.startswith('.')]
            for name in filenames:
                # Skip the empty Google Search Console verification file
                if not name.endswith('.html') or name.startswith('google'):
                    continue
                path = os.path.join(dirpath, name)
                with self.subTest(page=os.path.relpath(path, root)):
                    with open(path, 'r') as f:
                        errors = HTMLValidator().validate(f.read())
                    self.assertEqual(errors, [], f"HTML validation errors found: {', '.join(errors)}")

if __name__ == '__main__':
    unittest.main()

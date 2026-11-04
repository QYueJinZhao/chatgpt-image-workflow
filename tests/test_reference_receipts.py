"""Offline browser fixtures for the real reference-upload boundary."""
import unittest
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jf1sAAAAASUVORK5CYII="


class ReferenceReceiptTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(headless=True)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self):
        self.page = self.browser.new_page()
        self.page.set_content("""<form id="composer">
          <div contenteditable="true" role="textbox" aria-label="询问 ChatGPT"></div>
          <input id="upload" type="file" accept="image/*" multiple>
          <div id="attachments"></div>
        </form><form id="unrelated"></form>""")
        self.page.add_script_tag(path=str(ROOT / "extension/src/core.js"))
        self.page.add_script_tag(path=str(ROOT / "extension/src/capture.js"))
        self.page.clock.install()
        self.page.evaluate("""() => {
          window.changes = 0;
          window.makeReceipt = (parent, kind='modern') => {
            const surface = document.createElement('div');
            surface.className = 'composer-attachment-surface';
            const button = document.createElement('button');
            button.type = 'button';
            button.setAttribute('aria-label', kind === 'legacy' ? 'Remove file' : '移除“reference.png”');
            surface.append(button); parent.append(surface); return surface;
          };
        }""")

    def tearDown(self):
        self.page.close()

    def begin(self, on_change="makeReceipt(document.querySelector('#attachments'))", count=1):
        self.page.evaluate("""script => {
          document.querySelector('#upload').addEventListener('change', () => {
            window.changes++;
            Function(script)();
          });
        }""", on_change)
        self.page.evaluate("""payload => {
          window.result = {pending: true};
          const assets=Array.from({length:payload.count},(_,index)=>({
            name:index ? 'reference-'+index : 'reference', dataUrl:payload.pixel}));
          CPQCapture.attachReferences(document, assets)
            .then(() => { window.result = {ready: true}; })
            .catch(error => { window.result = {error: error.message}; });
        }""", {"pixel": PIXEL, "count": count})

    def result(self):
        return self.page.evaluate("({result: window.result, changes: window.changes})")

    def test_modern_chinese_reference_receipt(self):
        self.begin()
        self.page.clock.run_for(61000)
        self.assertEqual(self.result()["result"], {"ready": True})
        self.assertEqual(self.result()["changes"], 1)

    def test_legacy_reference_receipt(self):
        self.begin("makeReceipt(document.querySelector('#attachments'), 'legacy')")
        self.page.clock.run_for(1500)
        self.assertEqual(self.result()["result"], {"ready": True})

    def test_existing_modern_attachment_blocks_before_upload(self):
        self.page.evaluate("makeReceipt(document.querySelector('#attachments'))")
        self.begin()
        self.page.clock.run_for(10)
        result = self.result()
        self.assertIn("已有附件", result["result"].get("error", ""))
        self.assertEqual(result["changes"], 0)

    def test_upload_spinner_blocks_until_ready(self):
        self.begin("""const surface=makeReceipt(document.querySelector('#attachments'));
          const spinner=document.createElement('span'); spinner.className='animate-spin';
          spinner.id='spinner'; surface.append(spinner);""")
        self.page.clock.run_for(1500)
        self.assertEqual(self.result()["result"], {"pending": True})
        self.page.evaluate("document.querySelector('#spinner').remove()")
        self.page.clock.run_for(1500)
        self.assertEqual(self.result()["result"], {"ready": True})

    def test_aria_busy_blocks_until_ready(self):
        self.begin("""const surface=makeReceipt(document.querySelector('#attachments'));
          surface.setAttribute('aria-busy','true'); surface.id='busy';""")
        self.page.clock.run_for(1500)
        self.assertEqual(self.result()["result"], {"pending": True})
        self.page.evaluate("document.querySelector('#busy').setAttribute('aria-busy','false')")
        self.page.clock.run_for(1500)
        self.assertEqual(self.result()["result"], {"ready": True})

    def test_unrelated_form_is_not_an_existing_attachment(self):
        self.page.evaluate("makeReceipt(document.querySelector('#unrelated'))")
        self.begin()
        self.page.clock.run_for(1500)
        self.assertEqual(self.result()["result"], {"ready": True})

    def test_upload_uses_current_composer_form(self):
        self.page.evaluate("""() => {
          const other=document.querySelector('#unrelated');
          const input=document.createElement('input');input.type='file';input.accept='image/*';
          input.addEventListener('change',()=>{window.unrelatedChanges=(window.unrelatedChanges||0)+1;});
          other.append(input);document.body.prepend(other);
        }""")
        self.begin()
        self.page.clock.run_for(1500)
        self.assertEqual(self.result()["result"], {"ready": True})
        self.assertEqual(self.result()["changes"], 1)
        self.assertEqual(self.page.evaluate("window.unrelatedChanges || 0"), 0)

    def test_hidden_legacy_receipt_is_not_ready(self):
        self.begin("const surface=makeReceipt(document.querySelector('#attachments'),'legacy'); surface.hidden=true;")
        self.page.clock.run_for(61000)
        self.assertIn("未得到就绪回执", self.result()["result"].get("error", ""))

    def test_unrelated_remove_control_is_not_a_receipt(self):
        self.begin("""const b=document.createElement('button');b.type='button';
          b.setAttribute('aria-label','移除“unrelated-project”');
          document.querySelector('#composer').append(b);""")
        self.page.clock.run_for(61000)
        self.assertIn("未得到就绪回执", self.result()["result"].get("error", ""))

    def test_missing_receipt_is_not_ready(self):
        self.begin("")
        self.page.clock.run_for(61000)
        self.assertIn("未得到就绪回执", self.result()["result"].get("error", ""))

    def test_overlapping_markers_count_one_attachment(self):
        self.begin("""const surface=makeReceipt(document.querySelector('#attachments'),'legacy');
          surface.setAttribute('data-testid','attachment');""", count=2)
        self.page.clock.run_for(61000)
        self.assertIn("未得到就绪回执", self.result()["result"].get("error", ""))

    def test_two_independent_receipts_confirm_two_attachments(self):
        self.begin("""makeReceipt(document.querySelector('#attachments'));
          makeReceipt(document.querySelector('#attachments'),'legacy');""", count=2)
        self.page.clock.run_for(1500)
        self.assertEqual(self.result()["result"], {"ready": True})

    def test_two_legacy_receipts_under_one_list_remain_independent(self):
        self.begin("""const list=document.createElement('div');
          list.setAttribute('data-testid','attachment-list');
          for(const name of ['a.png','b.png']){
            const card=document.createElement('div');const button=document.createElement('button');
            button.type='button';button.setAttribute('aria-label','Remove file '+name);
            card.append(button);list.append(card);
          } document.querySelector('#attachments').append(list);""", count=2)
        self.page.clock.run_for(61000)
        self.assertEqual(self.result()["result"], {"ready": True})

    def test_readiness_is_checked_again_after_settling(self):
        self.begin("""const surface=makeReceipt(document.querySelector('#attachments'));
          setTimeout(()=>surface.setAttribute('aria-busy','true'),100);
          setTimeout(()=>surface.setAttribute('aria-busy','false'),1600);""")
        self.page.clock.run_for(1000)
        self.assertEqual(self.result()["result"], {"pending": True})
        self.page.clock.run_for(2000)
        self.assertEqual(self.result()["result"], {"ready": True})


if __name__ == "__main__":
    unittest.main()

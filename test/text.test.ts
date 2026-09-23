import assert from 'assert';
import {
  decodeEntities,
  diffOutput,
  extractHiddenInputs,
  looksLikeLatex,
  looksLikeFullSolution,
  normalizeOutput,
  outputEquals,
  parseAttrs,
  parseDateTime,
  parsePercent,
  redact,
  stripHtml
} from '../src/utils/text';

describe('utils/text', () => {
  it('decodeEntities 解码实体与数字编码', () => {
    assert.strictEqual(decodeEntities('a&amp;b&lt;c&#65;&#x42;'), 'a&b<cAB');
  });

  it('stripHtml 去标签保留换行', () => {
    const text = stripHtml('<p>第一行</p><br>第二行<script>x()</script>');
    assert.ok(text.includes('第一行'));
    assert.ok(text.includes('第二行'));
    assert.ok(!text.includes('x()'));
  });

  it('parseAttrs 提取属性', () => {
    const attrs = parseAttrs('<img src="a.png" alt=\'x&#65;\'>');
    assert.strictEqual(attrs['src'], 'a.png');
    assert.strictEqual(attrs['alt'], 'xA');
  });

  it('extractHiddenInputs 提取登录隐藏域', () => {
    const hidden = extractHiddenInputs(
      '<form><input type="hidden" id="uuid" value="u-1"><input type="hidden" id="enc" value="e-2"></form>'
    );
    assert.strictEqual(hidden['uuid'], 'u-1');
    assert.strictEqual(hidden['enc'], 'e-2');
  });

  it('parsePercent / parseDateTime', () => {
    assert.strictEqual(parsePercent('87.5%'), 87.5);
    assert.strictEqual(parsePercent(undefined), undefined);
    assert.ok(parseDateTime('2026-09-23 18:00:00') > 0);
    assert.strictEqual(parseDateTime(''), 0);
  });

  it('looksLikeLatex 识别公式文本', () => {
    assert.ok(looksLikeLatex('\\frac{a}{b}'));
    assert.ok(looksLikeLatex('$x^2$'));
    assert.ok(!looksLikeLatex('这是普通文字'));
  });

  it('normalizeOutput / outputEquals 忽略行尾空白', () => {
    assert.strictEqual(normalizeOutput('a  \nb\t\n\n'), 'a\nb');
    assert.ok(outputEquals('1 2\n3\n', '1 2\n3'));
    assert.ok(!outputEquals('1 2', '1 3'));
  });

  it('diffOutput 输出可读差异', () => {
    const diff = diffOutput('a\nb', 'a\nc');
    assert.ok(diff.includes('line 2'));
    assert.ok(diff.includes('expected "b"'));
  });

  it('looksLikeFullSolution 检出疑似完整代码', () => {
    assert.ok(looksLikeFullSolution('思路如下：\n```cpp\nint main(){}\n```'));
    assert.ok(!looksLikeFullSolution('可以考虑使用动态规划，注意边界条件。'));
  });

  it('redact 脱敏敏感信息', () => {
    const out = redact('Cookie: _uid=1; password=hunter2 Authorization: Bearer tok_123');
    assert.ok(!out.includes('hunter2'));
    assert.ok(!out.includes('tok_123'));
    assert.ok(out.includes('<redacted>'));
  });
});

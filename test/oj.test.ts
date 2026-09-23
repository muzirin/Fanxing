import assert from 'assert';
import { QuestionType } from '../src/config/constants';
import { formatAnswer } from '../src/api/oj';

describe('api/oj formatAnswer（题型作答格式化）', () => {
  it('单选：统一大写', () => {
    assert.strictEqual(formatAnswer(QuestionType.Single, 'b'), 'B');
    assert.strictEqual(formatAnswer(QuestionType.Single, ' A '), 'A');
  });

  it('多选：排序去重拼接', () => {
    assert.strictEqual(formatAnswer(QuestionType.Multiple, 'c，a b'), 'A,B,C');
    assert.strictEqual(formatAnswer(QuestionType.Multiple, 'B,A'), 'A,B');
  });

  it('判断：中文/英文多种写法归一', () => {
    assert.strictEqual(formatAnswer(QuestionType.Judge, '对'), 'true');
    assert.strictEqual(formatAnswer(QuestionType.Judge, '正确'), 'true');
    assert.strictEqual(formatAnswer(QuestionType.Judge, 'yes'), 'true');
    assert.strictEqual(formatAnswer(QuestionType.Judge, '错'), 'false');
    assert.strictEqual(formatAnswer(QuestionType.Judge, 'false'), 'false');
    assert.strictEqual(formatAnswer(QuestionType.Judge, '否'), 'false');
  });

  it('填空：多空以 ## 分隔', () => {
    assert.strictEqual(formatAnswer(QuestionType.Blank, '第一空\n第二空'), '第一空##第二空');
    assert.strictEqual(formatAnswer(QuestionType.Blank, '单空'), '单空');
    assert.strictEqual(formatAnswer(QuestionType.Blank, 'a##b'), 'a##b');
  });

  it('简答/编程：原文返回', () => {
    assert.strictEqual(formatAnswer(QuestionType.ShortAnswer, '  解释内容  '), '解释内容');
    assert.strictEqual(formatAnswer(QuestionType.Programming, 'int main() {}'), 'int main() {}');
  });
});

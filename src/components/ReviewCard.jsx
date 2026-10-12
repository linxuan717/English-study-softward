/**
 * 复习卡片组件
 *
 * 根据 questionType 渲染不同题型：
 *   recognition（再认题）：4选1
 *   recall（回忆题）：双层判断（认识→学会了/记错了；不认识→显示词义→学会了）
 *   blank（填空题）：原句挖空选词
 *   collocation（搭配题）：选正确搭配
 *
 * 结果通过 onResult 回调传给 ReviewSession
 */

import { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { QUESTION_TYPE } from '../services/appService.js';

const STAGE_LABELS = {
  new: '新词·再认',
  recognize: '能再认·回忆',
  recall: '能回忆·填空',
  mastered: '已掌握·搭配'
};

export default function ReviewCard({ card, question, onResult }) {
  const { service, refresh } = useApp();
  const [phase, setPhase] = useState('question'); // question → answered → done
  const [selectedIdx, setSelectedIdx] = useState(null);
  const [session, setSession] = useState(null); // 双层判断会话
  const [dualPhase, setDualPhase] = useState(null); // layer1 → layer2 → result
  const [showTranslation, setShowTranslation] = useState(false);

  // 切换到新卡片时重置所有状态
  useEffect(() => {
    setPhase('question');
    setSelectedIdx(null);
    setSession(null);
    setDualPhase(null);
    setShowTranslation(false);
  }, [card.id]);

  // ---- 客观题（再认/填空/搭配）----
  const handleSelect = (idx) => {
    if (phase !== 'question') return;
    setSelectedIdx(idx);
    const correct = idx === question.correctIndex;
    const context = question.context
      ? { sentence: question.context.sentence, articleId: question.context.articleId }
      : null;
    const result = service.handleObjectiveReview(card, correct, context);
    setPhase('answered');
    refresh();
    // 延迟展示结果后进入下一张
    setTimeout(() => onResult(result), 1500);
  };

  // ---- 回忆题（双层判断）----
  const startDualLayer = () => {
    const sess = service.createAssessmentSession(card);
    setSession(sess);
    setDualPhase('layer1');
    setPhase('dual');
  };

  const handleLayer1 = (known) => {
    const result = session.layer1(known);
    if (result.phase === 'layer2') {
      setDualPhase('layer2');
    } else if (result.phase === 'result_pending') {
      // 不认识 → 显示词义 → 等用户确认"学会了"
      setShowTranslation(true);
      setDualPhase('result_pending');
    }
  };

  const handleLayer2 = (choice) => {
    const result = session.layer2(choice);
    setShowTranslation(true);
    setDualPhase('result_pending');
  };

  const handleConfirm = () => {
    const result = session.confirm();
    // 提交 SM-2
    const context = question.context
      ? { sentence: question.context.sentence, articleId: question.context.articleId }
      : null;
    const sm2Result = service.handleDualLayerReview(card, result.grade, context);
    setPhase('done');
    refresh();
    setTimeout(() => onResult(sm2Result), 1000);
  };

  // ============================================================
  // 渲染
  // ============================================================
  if (!question) return null;

  const stageLabel = STAGE_LABELS[card.stage] || '未知';

  // ---- 回忆题（双层判断）----
  if (question.type === QUESTION_TYPE.RECALL && phase !== 'answered') {
    return (
      <div className="review-card">
        <div className="review-stage">{stageLabel} · 回忆题</div>
        <div className="review-word">{question.word}</div>
        {question.phonetic && <div className="review-phonetic">{question.phonetic}</div>}
        {question.context && (
          <div className="review-context">原句：{question.context.sentence}</div>
        )}

        {phase === 'question' && (
          <div className="review-actions">
            <button className="btn btn-danger" onClick={() => startDualLayer() ? null : null}>不认识</button>
            <button className="btn btn-primary" onClick={startDualLayer}>认识</button>
          </div>
        )}

        {phase === 'dual' && dualPhase === 'layer1' && null}

        {phase === 'dual' && (
          <DualLayerUI
            dualPhase={dualPhase}
            onLayer1={handleLayer1}
            onLayer2={handleLayer2}
            onConfirm={handleConfirm}
            showTranslation={showTranslation}
            translation={card.translation}
          />
        )}

        {phase === 'done' && (
          <div>
            <div className="review-translation">{card.translation}</div>
            <p style={{ color: 'var(--color-success)', marginTop: 12 }}>已记录</p>
          </div>
        )}
      </div>
    );
  }

  // ---- 客观题（再认/填空/搭配）----
  const typeLabel = {
    [QUESTION_TYPE.RECOGNITION]: '再认题·4选1',
    [QUESTION_TYPE.BLANK]: '填空题·原句挖空',
    [QUESTION_TYPE.COLLOCATION]: '搭配题'
  }[question.type] || '题目';

  return (
    <div className="review-card">
      <div className="review-stage">{stageLabel} · {typeLabel}</div>
      <div className="review-word">{question.word}</div>
      {question.phonetic && <div className="review-phonetic">{question.phonetic}</div>}

      {question.type === QUESTION_TYPE.BLANK && question.sentence && (
        <div className="review-context" style={{ fontSize: 16 }}>
          {question.sentence}
        </div>
      )}

      {question.prompt && <p style={{ marginBottom: 12 }}>{question.prompt}</p>}

      {question.options && (
        <div className="options">
          {question.options.map((opt, idx) => {
            let cls = 'option-btn';
            if (phase === 'answered') {
              if (idx === question.correctIndex) cls += ' correct';
              else if (idx === selectedIdx) cls += ' wrong';
            }
            return (
              <button key={idx} className={cls} onClick={() => handleSelect(idx)} disabled={phase !== 'question'}>
                {opt}
              </button>
            );
          })}
        </div>
      )}

      {phase === 'answered' && (
        <p style={{ marginTop: 16, color: selectedIdx === question.correctIndex ? 'var(--color-success)' : 'var(--color-danger)' }}>
          {selectedIdx === question.correctIndex ? '✓ 正确' : '✗ 正确答案：' + question.options[question.correctIndex]}
        </p>
      )}

      {question.context && phase === 'answered' && (
        <div className="review-context">原句：{question.context.sentence}</div>
      )}
    </div>
  );
}

/**
 * 双层判断 UI
 * layer1：认识 / 不认识
 * layer2（仅认识）：学会了 / 记错了
 * result_pending：显示词义，确认
 */
function DualLayerUI({ dualPhase, onLayer1, onLayer2, onConfirm, showTranslation, translation }) {
  if (dualPhase === 'layer1') {
    return (
      <div className="review-actions">
        <button className="btn btn-danger" onClick={() => onLayer1(false)}>不认识</button>
        <button className="btn btn-primary" onClick={() => onLayer1(true)}>认识</button>
      </div>
    );
  }

  if (dualPhase === 'layer2') {
    return (
      <div className="review-actions">
        <button className="btn btn-warning" onClick={() => onLayer2('remembered_wrong')}>记错了</button>
        <button className="btn btn-success" onClick={() => onLayer2('learned')}>学会了</button>
      </div>
    );
  }

  if (dualPhase === 'result_pending') {
    return (
      <div>
        {showTranslation && <div className="review-translation">{translation}</div>}
        <div className="review-actions">
          <button className="btn btn-primary" onClick={onConfirm}>确认</button>
        </div>
      </div>
    );
  }

  return null;
}

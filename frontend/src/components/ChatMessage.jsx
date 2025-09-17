import React from 'react';
import CodeBlock from './CodeBlock.jsx';

function detectCodeBlock(text) {
  const match = text.match(/```(\w+)?\n([\s\S]*?)\n```/);
  if (match) {
    return { language: match[1] || '', code: match[2] };
  }

  // Fallback: detect likely code
  const isLikelyCode = /import|function|const|let|class|=>/.test(text);
  if (isLikelyCode) {
    return { language: '', code: text };
  }

  return null;
}

export default function ChatMessage({ message, onRunCode }) {
  const codeData = detectCodeBlock(message.text);
  const roleClass = `chat-${message.role}`;

  if (codeData) {
    // Code block case — label + block
    return (
      <div>
        <span className={roleClass}>
          {message.role === 'agent' ? 'sentali' : message.role}:
        </span>
        <div style={{ marginTop: '4px' }}>
          <CodeBlock
            code={codeData.code}
            language={codeData.language}
            onRun={onRunCode}
          />
        </div>
      </div>
    );
  }

  // Plain text case — label + text inline
  return (
    <div>
      <span className={roleClass}>
        {message.role === 'agent' ? 'sentali' : message.role}:
      </span>{' '}
      <span>{message.text}</span>
    </div>
  );
}

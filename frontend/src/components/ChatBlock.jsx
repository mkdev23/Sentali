import React, { useState } from 'react';
import ChatMessage from './ChatMessage';

export default function ChatBlock({ messages, onRunCode }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={{ border: '1px solid #444', borderRadius: '6px' }}>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          cursor: 'pointer',
          background: '#bbb7b73d',
          color: '#fff',
          padding: '6px 10px',
          fontWeight: 'bold',
          userSelect: 'none'
        }}
      >
        {expanded ? '▼ Hide Chat' : '▶ Show Chat'}
      </div>

      {expanded && (
        <div style={{ padding: '8px', background: '#111', color: '#ddd' }}>
          {messages.map((m, idx) => (
            <ChatMessage key={idx} message={m} onRunCode={onRunCode} />
          ))}
        </div>
      )}
    </div>
  );
}

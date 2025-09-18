// components/ChatBlock.jsx
import React, { useState } from 'react';
import ChatMessage from './ChatMessage';

export default function ChatBlock({ messages = [], onRunCode }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={{ 
      border: '1px solid #444', 
      borderRadius: '6px',
      marginBottom: '8px',
      width: '100%',
      background: '#222',
      overflow: 'hidden'
    }}>
      {/* Toggle Header */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          cursor: 'pointer',
          background: 'rgba(187, 183, 119, 0.24)',
          color: '#fff',
          padding: '8px 12px',
          fontWeight: 'bold',
          userSelect: 'none',
          borderBottom: '1px solid #444',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}
      >
        <span>
          {expanded ? '▼ Hide Chat History' : '▶ Show Chat History'}
          {messages.length > 0 && (
            <span style={{ marginLeft: '8px', fontSize: '12px', color: '#aaa' }}>
              ({Math.ceil(messages.length / 2)} conversations)
            </span>
          )}
        </span>
      </div>
      
      {/* Messages Container - only shows when expanded */}
      {expanded && (
        <div style={{ 
          padding: '12px', 
          background: '#111', 
          color: '#ddd',
          maxHeight: '400px', 
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px'
        }}>
          {messages.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#888', fontStyle: 'italic' }}>
              No messages yet - start chatting!
            </div>
          ) : (
            messages.map((message, idx) => (
              <ChatMessage 
                key={idx} 
                message={message} 
                onRunCode={onRunCode}
                index={idx}
                messages={messages}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
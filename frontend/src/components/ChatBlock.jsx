// components/ChatBlock.jsx
import React from 'react';

export default function ChatBlock({ children }) {
  return (
    <div className="chat-entry" style={{ marginBottom: '8px' }}>
      {children}
    </div>
  );
}

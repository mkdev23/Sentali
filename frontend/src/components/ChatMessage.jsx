// components/ChatMessage.jsx
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

export default function ChatMessage({ message, onRunCode, index, messages }) {
  const codeData = detectCodeBlock(message.text);
  const roleClass = `chat-${message.role}`;
  
  // Check if this is a user message followed by an agent response
  const hasAgentResponse = message.role === 'user' && 
    index < messages.length - 1 && 
    messages[index + 1]?.role === 'agent';

  if (message.role === 'user') {
    // User message - show with optional agent response preview
    return (
      <div style={{ 
        marginBottom: hasAgentResponse ? '0px' : '12px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end'
      }}>
        {/* User message bubble */}
        <div style={{
          maxWidth: '70%',
          padding: '8px 12px',
          background: '#007bff',
          color: 'white',
          borderRadius: '12px 12px 4px 12px',
          marginBottom: '4px',
          wordWrap: 'break-word'
        }}>
          {message.text}
        </div>
        
        {/* Show agent response if it exists */}
        {hasAgentResponse && (
          <div style={{
            maxWidth: '70%',
            padding: '8px 12px',
            background: '#333',
            color: '#ddd',
            borderRadius: '4px 12px 12px 12px',
            wordWrap: 'break-word'
          }}>
            {codeData ? (
              // Code block response
              <div>
                <CodeBlock
                  code={codeData.code}
                  language={codeData.language}
                  onRun={onRunCode}
                />
              </div>
            ) : (
              // Text response
              <span>{messages[index + 1].text}</span>
            )}
          </div>
        )}
      </div>
    );
  }

  // Agent message (standalone) - this shouldn't normally happen with the new logic
  if (codeData) {
    return (
      <div style={{ 
        marginBottom: '12px',
        display: 'flex',
        justifyContent: 'flex-start'
      }}>
        <div style={{
          maxWidth: '70%',
          padding: '8px 12px',
          background: '#333',
          color: '#ddd',
          borderRadius: '12px 12px 12px 4px',
          wordWrap: 'break-word'
        }}>
          <div style={{ marginBottom: '4px', fontWeight: 'bold', color: '#fff' }}>
            sentali:
          </div>
          <CodeBlock
            code={codeData.code}
            language={codeData.language}
            onRun={onRunCode}
          />
        </div>
      </div>
    );
  }

  // Plain agent text message
  return (
    <div style={{ 
      marginBottom: '12px',
      display: 'flex',
      justifyContent: 'flex-start'
    }}>
      <div style={{
        maxWidth: '70%',
        padding: '8px 12px',
        background: '#333',
        color: '#ddd',
        borderRadius: '12px 12px 12px 4px',
        wordWrap: 'break-word'
      }}>
        <div style={{ marginBottom: '4px', fontWeight: 'bold', color: '#fff' }}>
          sentali:
        </div>
        <span>{message.text}</span>
      </div>
    </div>
  );
}
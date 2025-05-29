import React, { useState, useRef, useEffect } from "react";

// Simple markdown renderer component
function MarkdownRenderer({ content }) {
  const renderMarkdown = (text) => {
    // Convert markdown to HTML
    let html = text
      // Headers
      .replace(/^### (.*$)/gm, '<h3 class="markdown-h3">$1</h3>')
      .replace(/^## (.*$)/gm, '<h2 class="markdown-h2">$1</h2>')
      .replace(/^# (.*$)/gm, '<h1 class="markdown-h1">$1</h1>')
      // Bold
      .replace(/\*\*(.*?)\*\*/g, '<strong class="markdown-bold">$1</strong>')
      // Italic
      .replace(/\*(.*?)\*/g, '<em class="markdown-italic">$1</em>')
      // Code blocks
      .replace(/```([\s\S]*?)```/g, '<pre class="markdown-code-block"><code>$1</code></pre>')
      // Inline code
      .replace(/`([^`]+)`/g, '<code class="markdown-inline-code">$1</code>')
      // Unordered lists
      .replace(/^\* (.*$)/gm, '<li class="markdown-list-item">$1</li>')
      .replace(/(<li class="markdown-list-item">.*<\/li>)/s, '<ul class="markdown-list">$1</ul>')
      // Ordered lists
      .replace(/^\d+\. (.*$)/gm, '<li class="markdown-ordered-item">$1</li>')
      .replace(/(<li class="markdown-ordered-item">.*<\/li>)/s, '<ol class="markdown-ordered-list">$1</ol>')
      // Line breaks
      .replace(/\n\n/g, '</p><p class="markdown-paragraph">')
      .replace(/\n/g, '<br />')
      // Wrap in paragraph tags
      .replace(/^(?!<[h1-6]|<ul|<ol|<pre|<\/p>)(.+)$/gm, '<p class="markdown-paragraph">$1</p>');

    return html;
  };

  return (
    <div 
      className="markdown-content"
      dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
    />
  );
};

function ChatComponent({ onClose }) {
  // holds the current user input and the chat history.
  const [inputMessage, setInputMessage] = useState("");
  const [chatHistory, setChatHistory] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

    // New state to track whether to show suggested questions
  const [showSuggestions, setShowSuggestions] = useState(true);
    // New state to store the randomly selected questions
  const [randomQuestions, setRandomQuestions] = useState([]);
  
    // List Predefined questions
  const suggestedQuestions = [
      "What is the Allora Network?",
      "What role do worker nodes play in the network?",
      "What are the different layers of of the network?",
      "What are the main defining characteristics of Allora?",
      "What are the differences between Reputers and Validators?",
      "How do consumers access inferences within Allora?",
      "What role does context awareness play in Allora's design, and how is it achieved through forecasting tasks?",
      "How does Allora ensure the reliability and security of the network?",
      "How does the tokenomics design of the Allora token (ALLO) ensure long-term network sustainability?",
    ];
  
    // Function to select 3 random questions
  const getRandomQuestions = () => {
      const shuffled = [...suggestedQuestions].sort(() => 0.5 - Math.random());
      return shuffled.slice(0, 3);
    };
  
    // Initialize with 3 random questions on component mount
  useEffect(() => {
      setRandomQuestions(getRandomQuestions());
  }, []);
  

  // this references the chat history container.
  const chatContainerRef = useRef(null);

  // gives an auto-scroll effect to the bottom whenever the chat history changes.
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [chatHistory]);

    // Hide suggestions when conversation starts
  useEffect(() => {
      if (chatHistory.length > 0) {
        setShowSuggestions(false);
      }
    }, [chatHistory]);
    // New handler for when a suggested question is clicked
    const handleSuggestionClick = (question) => {
      // Process the suggested question like a regular submission
      handleMessageSubmit(question);
    };
  
    // Extracted logic to handle message submission
    const handleMessageSubmit = async (message) => {
      // Add user's message to the chat history.
      const newUserEntry = { 
        sender: "user", 
        text: message.trim() // Trim any extra whitespace
      };
      setChatHistory((prev) => [...prev, newUserEntry]);
      
      // Show loading indicator
      setIsLoading(true);
      
      try {
        // Send user's message to the FastAPI backend.
        const response = await fetch("https://b832b91b8183b88b9c22eda604f1e09.testnet.allora.run/chat", { 
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ message: message.trim() }),
        });
        console.log("API went through");
  
        if (!response.ok) {
          throw new Error(`Server error: ${response.statusText}`);
        }
  
        // Parse the JSON response.
        const data = await response.json();
        
        // Add the assistant's response to the chat history.
        const newBotEntry = {
          sender: "bot",
          text: data.response,
          sources: data.sources,
        };
        setChatHistory((prev) => [...prev, newBotEntry]);
      } catch (error) {
        console.error("Error fetching chat response:", error);
        // display an error message in the UI.
        const errorEntry = { 
          sender: "bot", 
          text: "Sorry, something went wrong. Please try again." 
        };
        setChatHistory((prev) => [...prev, errorEntry]);
      } finally {
        // Hide loading indicator
        setIsLoading(false);
      }
    };
  
    // this is handler for form submission.
    const handleSubmit = async (e) => {
      e.preventDefault();
      
      // Store the message and immediately clear the input field
      const message = inputMessage;
      setInputMessage(""); // Clear input immediately
      
      // Process the message
      await handleMessageSubmit(message);
    };
  return (
    <div
      className="chat-container"
      style={{
        position: "fixed",
        bottom: "20px",
        right: "20px",
        maxWidth: "450px",
        width: "100%",
        backgroundColor: "#0f0f0f",
        color: "#fff",
        padding: "0px",
        borderRadius: "20px",
        boxShadow: "0 8px 40px rgba(0, 0, 0, 0.4)",
        backdropFilter: "blur(20px)",
        border: "1px solid rgba(255, 255, 255, 0.08)",
        animation: "slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
      }}
    >
      <style jsx>{`
        input:focus {
          outline: 2px solid #3b82f6 !important;
          outline-offset: 0px;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
        }
        input {
          outline: none;
        }
        .close-button:hover {
          color: #ef4444 !important;
          background-color: rgba(239, 68, 68, 0.1) !important;
          transform: scale(1.1);
        }
        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateY(100px) scale(0.95);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        
        /* Markdown Styles */
        .markdown-content {
          line-height: 1.6;
        }
        .markdown-content .markdown-h1 {
          font-size: 1.5rem;
          font-weight: 700;
          margin: 1rem 0 0.5rem 0;
          color: #f1f5f9;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
          padding-bottom: 0.5rem;
        }
        .markdown-content .markdown-h2 {
          font-size: 1.3rem;
          font-weight: 600;
          margin: 0.8rem 0 0.4rem 0;
          color: #f1f5f9;
        }
        .markdown-content .markdown-h3 {
          font-size: 1.1rem;
          font-weight: 600;
          margin: 0.6rem 0 0.3rem 0;
          color: #e2e8f0;
        }
        .markdown-content .markdown-bold {
          font-weight: 600;
          color: #f8fafc;
        }
        .markdown-content .markdown-italic {
          font-style: italic;
          color: #cbd5e1;
        }
        .markdown-content .markdown-inline-code {
          background-color: rgba(99, 102, 241, 0.1);
          color: #a5b4fc;
          padding: 0.2rem 0.4rem;
          border-radius: 0.25rem;
          font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
          font-size: 0.85rem;
          border: 1px solid rgba(99, 102, 241, 0.2);
        }
        .markdown-content .markdown-code-block {
          background-color: rgba(15, 23, 42, 0.8);
          border: 1px solid rgba(71, 85, 105, 0.3);
          border-radius: 0.5rem;
          padding: 1rem;
          margin: 0.8rem 0;
          overflow-x: auto;
          font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
          font-size: 0.85rem;
          line-height: 1.5;
        }
        .markdown-content .markdown-code-block code {
          color: #e2e8f0;
          background: none;
          padding: 0;
          border: none;
        }
        .markdown-content .markdown-list {
          margin: 0.5rem 0;
          padding-left: 1.5rem;
        }
        .markdown-content .markdown-ordered-list {
          margin: 0.5rem 0;
          padding-left: 1.5rem;
        }
        .markdown-content .markdown-list-item,
        .markdown-content .markdown-ordered-item {
          margin: 0.3rem 0;
          color: #e2e8f0;
        }
        .markdown-content .markdown-paragraph {
          margin: 0.5rem 0;
          color: #e2e8f0;
        }
        .markdown-content .markdown-paragraph:first-child {
          margin-top: 0;
        }
        .markdown-content .markdown-paragraph:last-child {
          margin-bottom: 0;
        }
        
        /* Custom scrollbar */
        .chat-history::-webkit-scrollbar {
          width: 6px;
        }
        .chat-history::-webkit-scrollbar-track {
          background: transparent;
        }
        .chat-history::-webkit-scrollbar-thumb {
          background: rgba(156, 163, 175, 0.3);
          border-radius: 3px;
        }
        .chat-history::-webkit-scrollbar-thumb:hover {
          background: rgba(156, 163, 175, 0.5);
        }
      `}</style>

      {/* Header with title and close button */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "20px 24px 16px 24px",
          borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
        }}
      >
        <h2 style={{ 
          color: "#f8fafc", 
          margin: 0,
          fontSize: "1.25rem",
          fontWeight: "600",
          letterSpacing: "-0.025em"
        }}>Allie, Allora's AI Assistant</h2>
        <button
          onClick={onClose}
          className="close-button"
          style={{
            background: "transparent",
            border: "none",
            color: "#94a3b8",
            cursor: "pointer",
            fontSize: "1.5rem",
            padding: "8px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "8px",
            transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
            width: "32px",
            height: "32px"
          }}
          aria-label="Close Chat"
        >
          ×
        </button>
      </div>

      <div
        className="chat-history"
        ref={chatContainerRef}
        style={{
          padding: "16px 24px",
          height: "420px",
          overflowY: "auto",
          backgroundColor: "transparent",
          position: "relative",
          scrollBehavior: "smooth",
        }}
      >
        {/* Suggested Questions */}
        {showSuggestions && (
          <div style={{ 
            display: "flex", 
            flexDirection: "column", 
            gap: "12px",
            padding: "8px 0"
          }}>
            <div style={{ 
              color: "#94a3b8", 
              marginBottom: "4px",
              fontSize: "0.9rem",
              fontWeight: "500"
            }}>
              ✨ Try asking about:
            </div>
            {randomQuestions.map((question, index) => (
              <button
                key={index}
                onClick={() => handleSuggestionClick(question)}
                style={{
                  background: "rgba(30, 41, 59, 0.5)",
                  color: "#e2e8f0",
                  border: "1px solid rgba(71, 85, 105, 0.3)",
                  borderRadius: "12px",
                  padding: "12px 16px",
                  textAlign: "left",
                  cursor: "pointer",
                  transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
                  fontSize: "0.9rem",
                  lineHeight: "1.4",
                  backdropFilter: "blur(10px)"
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.backgroundColor = "rgba(51, 63, 82, 0.6)";
                  e.currentTarget.style.borderColor = "rgba(99, 102, 241, 0.4)";
                  e.currentTarget.style.transform = "translateY(-1px)";
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.backgroundColor = "rgba(30, 41, 59, 0.5)";
                  e.currentTarget.style.borderColor = "rgba(71, 85, 105, 0.3)";
                  e.currentTarget.style.transform = "translateY(0)";
                }}
              >
                {question}
              </button>
            ))}
          </div>
        )}

        {chatHistory.map((entry, index) => (
          <div
            key={index}
            style={{
              textAlign: entry.sender === "user" ? "right" : "left",
              margin: "16px 0",
              display: "flex",
              justifyContent: entry.sender === "user" ? "flex-end" : "flex-start",
            }}
          >
            <div
              style={{
                maxWidth: "85%",
                background: entry.sender === "user" 
                  ? "linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)" 
                  : "rgba(30, 41, 59, 0.6)",
                color: "#fff",
                padding: "14px 18px",
                borderRadius: entry.sender === "user" ? "20px 20px 6px 20px" : "20px 20px 20px 6px",
                boxShadow: entry.sender === "user" 
                  ? "0 4px 16px rgba(59, 130, 246, 0.2)" 
                  : "0 4px 16px rgba(0, 0, 0, 0.1)",
                backdropFilter: "blur(10px)",
                border: entry.sender === "user" 
                  ? "1px solid rgba(59, 130, 246, 0.3)" 
                  : "1px solid rgba(71, 85, 105, 0.2)",
                wordBreak: "break-word",
                fontSize: "0.95rem",
                lineHeight: "1.5",
                whiteSpace: "normal",
                textAlign: "left",
                animation: "slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)"
              }}
            >
              {entry.sender === "bot" ? (
                <MarkdownRenderer content={entry.text} />
              ) : (
                entry.text
              )}
              
              {/* Sources display for bot messages */}
              {entry.sources && entry.sources.length > 0 && (
                <div style={{
                  marginTop: "12px",
                  paddingTop: "8px",
                  borderTop: "1px solid rgba(71, 85, 105, 0.3)",
                  fontSize: "0.8rem",
                  color: "#94a3b8"
                }}>
                  <div style={{ marginBottom: "4px", fontWeight: "500" }}>Sources:</div>
                  {entry.sources.map((source, idx) => (
                    <div key={idx} style={{ marginBottom: "2px" }}>
                      📄 {source}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        
        {/* Enhanced Loading indicator */}
        {isLoading && (
          <div style={{ textAlign: "left", margin: "16px 0" }}>
            <div
              style={{
                display: "inline-block",
                background: "rgba(30, 41, 59, 0.6)",
                color: "#fff",
                padding: "14px 18px",
                borderRadius: "20px 20px 20px 6px",
                backdropFilter: "blur(10px)",
                border: "1px solid rgba(71, 85, 105, 0.2)",
              }}
            >
              <div className="loading-indicator" style={{ 
                display: "flex", 
                alignItems: "center",
                gap: "8px"
              }}>
                <div style={{ display: "flex", gap: "4px" }}>
                  <div style={{ 
                    width: "6px", 
                    height: "6px", 
                    backgroundColor: "#3b82f6", 
                    borderRadius: "50%", 
                    animation: "pulse 1.4s ease-in-out infinite",
                    animationDelay: "0s"
                  }} />
                  <div style={{ 
                    width: "6px", 
                    height: "6px", 
                    backgroundColor: "#3b82f6", 
                    borderRadius: "50%", 
                    animation: "pulse 1.4s ease-in-out infinite",
                    animationDelay: "0.2s"
                  }} />
                  <div style={{ 
                    width: "6px", 
                    height: "6px", 
                    backgroundColor: "#3b82f6", 
                    borderRadius: "50%", 
                    animation: "pulse 1.4s ease-in-out infinite",
                    animationDelay: "0.4s"
                  }} />
                </div>
                <span style={{ fontSize: "0.9rem", color: "#94a3b8" }}>Thinking...</span>
              </div>
            </div>
          </div>
        )}
      </div>

      <div 
        style={{ 
          padding: "16px 24px 20px 24px",
          display: "flex",
          alignItems: "center",
          gap: "12px",
          borderTop: "1px solid rgba(255, 255, 255, 0.08)",
        }}
      >
        <textarea
          value={inputMessage}
          onChange={(e) => setInputMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              const syntheticEvent = { preventDefault: () => {} };
              handleSubmit(syntheticEvent);
            }
          }}
          placeholder="Ask me anything..."
          required
          rows={1}
          style={{
            flex: "1",
            minHeight: "44px",
            maxHeight: "120px",
            padding: "12px 16px",
            backgroundColor: "rgba(30, 41, 59, 0.5)",
            color: "#f1f5f9",
            border: "1px solid rgba(71, 85, 105, 0.3)",
            borderRadius: "12px",
            fontSize: "0.95rem",
            transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
            outline: "none",
            resize: "none",
            fontFamily: 'inherit',
            lineHeight: "1.5"
          }}
        />
        <button
          onClick={(e) => {
            e.preventDefault();
            const syntheticEvent = { preventDefault: () => {} };
            handleSubmit(syntheticEvent);
          }}
          disabled={!inputMessage.trim() || isLoading}
          style={{
            padding: "12px 16px",
            backgroundColor: inputMessage.trim() && !isLoading ? "#3b82f6" : "rgba(71, 85, 105, 0.5)",
            color: "#fff",
            border: "none",
            borderRadius: "12px",
            cursor: inputMessage.trim() && !isLoading ? "pointer" : "not-allowed",
            fontSize: "0.9rem",
            fontWeight: "500",
            transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minWidth: "60px",
            height: "44px",
            opacity: inputMessage.trim() && !isLoading ? 1 : 0.5
          }}
          onMouseOver={(e) => {
            if (inputMessage.trim() && !isLoading) {
              e.currentTarget.style.backgroundColor = "#1d4ed8";
              e.currentTarget.style.transform = "scale(1.02)";
            }
          }}
          onMouseOut={(e) => {
            if (inputMessage.trim() && !isLoading) {
              e.currentTarget.style.backgroundColor = "#3b82f6";
              e.currentTarget.style.transform = "scale(1)";
            }
          }}
        >
          {isLoading ? "..." : "Send"}
        </button>
      </div>
    </div>
  );
}

export default ChatComponent;

import React, { useState, useRef, useEffect } from "react";

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
      "What are the different layers of the network?",
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
          text: "Sorry, something went wrong." 
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
        maxWidth: "400px",
        width: "100%",
        backgroundColor: "#1a1a1a",
        color: "#fff",
        padding: "20px",
        borderRadius: "16px",
        boxShadow: "0 4px 30px rgba(0, 0, 0, 0.3)",
        backdropFilter: "blur(10px)",
        border: "1px solid rgba(255, 255, 255, 0.1)",
        animation: "slideIn 0.2s ease-out"
      }}
    >
      <style jsx>{`
        input:focus {
          outline: 2px solid #2563eb !important;
          outline-offset: 0px;
          box-shadow: none;
        }
        input {
          outline: none;
        }
        .close-button:hover {
          color: #ff4444 !important;
          text-shadow: 0 0 8px rgba(255, 68, 68, 0.6);
          opacity: 1 !important;
        }
        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateY(100px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>

      {/* Header with title and close button */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "15px",
          borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
          paddingBottom: "15px",
        }}
      >
        <h2 style={{ 
          color: "#fff", 
          margin: 0,
          fontSize: "1.25rem",
          fontWeight: "600"
        }}>Chat with our AI</h2>
        <button
          onClick={onClose}
          className="close-button"
          style={{
            background: "transparent",
            border: "none",
            color: "#fff",
            cursor: "pointer",
            fontSize: "1.25rem",
            padding: "5px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: "0.7",
            transition: "all 0.2s ease"
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
          padding: "10px",
          height: "400px",
          overflowY: "auto",
          backgroundColor: "#1a1a1a",
          position: "relative",
          scrollBehavior: "smooth",
          "&::-webkit-scrollbar": {
            width: "8px",
          },
          "&::-webkit-scrollbar-track": {
            background: "#1a1a1a",
          },
          "&::-webkit-scrollbar-thumb": {
            background: "#333",
            borderRadius: "4px",
          },
        }}
      >
              {/* Suggested Questions - now using randomQuestions instead of suggestedQuestions */}
              {showSuggestions && (
          <div style={{ 
            display: "flex", 
            flexDirection: "column", 
            gap: "10px",
            padding: "10px"
          }}>
            <div style={{ color: "#ccc", marginBottom: "5px" }}>
              Try asking a question below or type your own:
            </div>
            {randomQuestions.map((question, index) => (
              <button
                key={index}
                onClick={() => handleSuggestionClick(question)}
                style={{
                  background: "#333",
                  color: "#fff",
                  border: "1px solid #555",
                  borderRadius: "8px",
                  padding: "10px",
                  textAlign: "left",
                  cursor: "pointer",
                  transition: "background-color 0.2s",
                }}
                onMouseOver={(e) => e.currentTarget.style.backgroundColor = "#444"}
                onMouseOut={(e) => e.currentTarget.style.backgroundColor = "#333"}
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
              margin: "12px 0",
              display: "flex",
              justifyContent: entry.sender === "user" ? "flex-end" : "flex-start",
            }}
          >
            <div
              style={{
                maxWidth: "80%",
                background: entry.sender === "user" ? "#2563eb" : "#27272a",
                color: "#fff",
                padding: "12px 16px",
                borderRadius: "12px",
                borderBottomRightRadius: entry.sender === "user" ? "4px" : "12px",
                borderBottomLeftRadius: entry.sender === "user" ? "12px" : "4px",
                boxShadow: "0 2px 5px rgba(0,0,0,0.1)",
                wordBreak: "break-word",
                fontSize: "0.95rem",
                lineHeight: "1.5",
                whiteSpace: "normal",
                textAlign: "left"
              }}
            >
              {entry.text}
            </div>
          </div>
        ))}
        
        {/* Loading indicator */}
        {isLoading && (
          <div style={{ textAlign: "left", margin: "12px 0" }}>
            <div
              style={{
                display: "inline-block",
                background: "#27272a",
                color: "#fff",
                padding: "12px 16px",
                borderRadius: "12px",
                borderBottomLeftRadius: "4px",
              }}
            >
              <div className="loading-indicator" style={{ 
                display: "flex", 
                alignItems: "center",
                gap: "10px"
              }}>
                <div 
                  style={{ 
                    width: "12px", 
                    height: "12px", 
                    border: "2px solid rgba(255,255,255,0.2)", 
                    borderRadius: "50%", 
                    borderTopColor: "#fff", 
                    animation: "spin 0.8s linear infinite"
                  }} 
                />
                <span style={{ fontSize: "0.9rem" }}>Thinking...</span>
              </div>
            </div>
          </div>
        )}
      </div>

      <form 
        onSubmit={handleSubmit} 
        style={{ 
          marginTop: "15px",
          display: "flex",
          alignItems: "center",
          gap: "10px",
          borderTop: "1px solid rgba(255, 255, 255, 0.1)",
          paddingTop: "15px",
        }}
      >
        <input
          type="text"
          value={inputMessage}
          onChange={(e) => setInputMessage(e.target.value)}
          placeholder="Type your message..."
          required
          style={{
            flex: "1",
            padding: "12px 16px",
            backgroundColor: "#27272a",
            color: "#fff",
            border: "1px solid rgba(255, 255, 255, 0.1)",
            borderRadius: "8px",
            fontSize: "0.95rem",
            transition: "all 0.2s ease",
            outline: "none",
            "&:focus": {
              borderColor: "#2563eb",
              boxShadow: "0 0 0 1px #2563eb"
            },
            "&:focus-visible": {
              outline: "2px solid #2563eb",
              outlineOffset: "0px"
            }
          }}
        />
        <button
          type="submit"
          style={{
            padding: "12px 20px",
            backgroundColor: "#2563eb",
            color: "#fff",
            border: "none",
            borderRadius: "8px",
            cursor: "pointer",
            fontSize: "0.95rem",
            fontWeight: "500",
            transition: "background-color 0.2s ease",
            "&:hover": {
              backgroundColor: "#1d4ed8",
            },
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          Send
        </button>
      </form>
    </div>
  );
}

export default ChatComponent;

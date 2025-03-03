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
    const newUserEntry = { sender: "user", text: message };
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
        body: JSON.stringify({ message: message }),
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
        sender: "bot", text: "Sorry, something went wrong." 
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
        maxWidth: "600px",
        minWidth: "340px",
        margin: "0 auto",
        backgroundColor: "#000", 
        color: "#fff",
        padding: "20px",
        borderRadius: "10px",
      }}
    >
      {/* Header with title and close button */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "10px",
        }}
      >
        <h2 style={{ color: "#fff", margin: 0 }}>Chat with our AI</h2>
        <button
          onClick={onClose}
          style={{
            background: "transparent",
            border: "none",
            color: "#fff",
            cursor: "pointer",
            fontSize: "16px",
          }}
          aria-label="Close Chat"
        >
          ❌
        </button>
      </div>

      <div
        className="chat-history"
        ref={chatContainerRef}
        style={{
          border: "1px solid #ccc",
          padding: "10px",
          height: "300px",
          overflowY: "scroll",
          backgroundColor: "#1e1e1e",
          position: "relative",
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
              margin: "10px 0",
            }}
          >
            <div
              style={{
                display: "inline-block",
                background: entry.sender === "user" ? "#4caf50" : "#333",
                color: "#fff",
                padding: "10px",
                borderRadius: "10px",
                maxWidth: "70%",
                wordWrap: "break-word",
                textAlign: "left",
              }}
            >
              <p style={{ margin: 0 }}>{entry.text}</p>
              {entry.sources && entry.sources.length > 0 }
            </div>
          </div>
        ))}
        
        {/* Loading indicator */}
        {isLoading && (
          <div
            style={{
              textAlign: "left",
              margin: "10px 0",
            }}
          >
            <div
              style={{
                display: "inline-block",
                background: "#333",
                color: "#fff",
                padding: "10px",
                borderRadius: "10px",
              }}
            >
              <div className="loading-indicator" style={{ display: "flex", alignItems: "center" }}>
                <div 
                  style={{ 
                    width: "16px", 
                    height: "16px", 
                    border: "3px solid rgba(255,255,255,0.3)", 
                    borderRadius: "50%", 
                    borderTopColor: "#fff", 
                    animation: "spin 1s ease-in-out infinite",
                    marginRight: "10px"
                  }} 
                />
                <span>Thinking...</span>
              </div>
              <style jsx>{`
                @keyframes spin {
                  to { transform: rotate(360deg); }
                }
              `}</style>
            </div>
          </div>
        )}
      </div>
      <form 
        onSubmit={handleSubmit} 
        style={{ 
          marginTop: "10px",
          display: "flex",
          alignItems: "center",
          gap: "10px"
        }}
      >
        <input
          type="text"
          value={inputMessage}
          onChange={(e) => {
            setInputMessage(e.target.value);
            // Hide suggestions when user starts typing
            if (e.target.value.length > 0) {
              setShowSuggestions(false);
            }
          }}
          placeholder="Type your message..."
          required
          style={{
            flex: "1",
            padding: "10px",
            backgroundColor: "#333",
            color: "#fff",
            border: "1px solid #555",
            borderRadius: "5px",
          }}
        />
        <button
          type="submit"
          style={{
            minWidth: "80px",
            padding: "10px 15px",
            backgroundColor: "#4caf50",
            color: "#fff",
            border: "none",
            borderRadius: "5px",
            cursor: "pointer",
            whiteSpace: "nowrap",
            height: "40px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center"
          }}
        >
          Send
        </button>
      </form>
    </div>
  );
}

export default ChatComponent;

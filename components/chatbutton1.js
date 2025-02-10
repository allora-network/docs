import React, { useState, useRef, useEffect } from "react";

function ChatComponent({ onClose }) {
  // holds the current user input and the chat history.
  const [inputMessage, setInputMessage] = useState("");
  const [chatHistory, setChatHistory] = useState([]);

  // this references the chat history container.
  const chatContainerRef = useRef(null);

  // gives an auto-scroll effect to the bottom whenever the chat history changes.
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [chatHistory]);

  // this is handler for form submission.
  const handleSubmit = async (e) => {
    e.preventDefault();

    // Add user's message to the chat history.
    const newUserEntry = { sender: "user", text: inputMessage };
    setChatHistory((prev) => [...prev, newUserEntry]);

    try {
      // Send user's message to the FastAPI backend.
      const response = await fetch("https://b832b91b8183b88b9c22eda604f1e09.testnet.allora.run/chat", { // Update the URL during production
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message: inputMessage }),
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
    }

    // Clear the input field.
    setInputMessage("");
  };

  return (
    <div
      className="chat-container"
      style={{
        maxWidth: "600px",
        margin: "0 auto",
        backgroundColor: "#000", 
        color: "#fff", // Set text color to white for visibility
        padding: "20px",
        borderRadius: "10px", // Rounded corners nicer UI
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
          height: "300px", // Fixed height
          overflowY: "scroll", // Enable vertical scrolling
          backgroundColor: "#1e1e1e", // Darker background for chat history
        }}
      >
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
              }}
            >
              <p style={{ margin: 0 }}>{entry.text}</p>
              {entry.sources && entry.sources.length > 0 }
            </div>
          </div>
        ))}
      </div>
      <form onSubmit={handleSubmit} style={{ marginTop: "10px" }}>
        <input
          type="text"
          value={inputMessage}
          onChange={(e) => setInputMessage(e.target.value)}
          placeholder="Type your message..."
          required
          style={{
            width: "80%",
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
            width: "18%",
            padding: "10px",
            marginLeft: "2%",
            backgroundColor: "#4caf50",
            color: "#fff",
            border: "none",
            borderRadius: "5px",
            cursor: "pointer",
          }}
        >
          Send
        </button>
      </form>
    </div>
  );
}

export default ChatComponent;

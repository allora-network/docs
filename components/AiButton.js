import React, { useState } from "react";
import ChatComponent from "./chatbutton1"; // Adjust the path as needed

function AiButton() {
  // State to control whether the ChatComponent is displayed
  const [showChat, setShowChat] = useState(false);

  // Toggle function to open or close the chat
  const toggleChat = () => {
    setShowChat((prev) => !prev);
  };

  return (
    <div style={{ maxWidth: "800px", margin: "0 auto", padding: "20px" }}>
      <button
        onClick={toggleChat}
        style={{
          padding: "10px 20px",
          fontSize: "16px",
          cursor: "pointer",
          marginBottom: "20px",
          backgroundColor: "#007bff",
          color: "#fff",
          border: "none",
          borderRadius: "5px",
          transition: "all 0.2s ease",
          opacity: showChat ? 0 : 1,
          transform: showChat ? "scale(0.95)" : "scale(1)",
          pointerEvents: showChat ? "none" : "auto"
        }}
        onMouseOver={(e) => (e.target.style.backgroundColor = "#0056b3")}
        onMouseOut={(e) => (e.target.style.backgroundColor = "#007bff")}
      >
        Ask AI
      </button>

      <div style={{
        position: "fixed",
        bottom: 0,
        right: 0,
        opacity: showChat ? 1 : 0,
        visibility: showChat ? "visible" : "hidden",
        transition: "opacity 0.2s ease, visibility 0.2s ease",
      }}>
        {showChat && <ChatComponent onClose={toggleChat} />}
      </div>

      <style jsx>{`
        button:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(0, 123, 255, 0.2);
        }
      `}</style>
    </div>
  );
}

export default AiButton;

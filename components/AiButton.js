
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
    <>
      {/* Render the "Ask AI" button if the chat is not shown */}
      {!showChat && (
        <button
          onClick={toggleChat}
          style={{
            position: "fixed",
            bottom: "20px",
            right: "20px",
            padding: "10px 20px",
            fontSize: "16px",
            cursor: "pointer",
            backgroundColor: "#007bff", // Blue background
            color: "#fff", // White text
            border: "none", // Remove default border
            borderRadius: "5px", // Rounded corners
            transition: "background-color 0.3s ease", // Smooth hover effect
            zIndex: 1000, // Ensure it stays on top
          }}
          onMouseOver={(e) => (e.target.style.backgroundColor = "#0056b3")} // Darker blue on hover
          onMouseOut={(e) => (e.target.style.backgroundColor = "#007bff")} // Revert on mouse out
        >
          Ask AI
        </button>
      )}
      {/* Render the ChatComponent when showChat is true, passing the onClose prop */}
      {showChat && (
        <div style={{ 
          position: "fixed", 
          bottom: "20px", 
          right: "20px", 
          zIndex: 1000 
        }}>
          <ChatComponent onClose={toggleChat} />
        </div>
      )}
    </>
  );
}

export default AiButton;

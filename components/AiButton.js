
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
      {/* Ask AI button is hidden */}
      {/* Render the ChatComponent when showChat is true, passing the onClose prop */}
      {showChat && <ChatComponent onClose={toggleChat} />}
    </div>
  );
}

export default AiButton;

// Global variables
let drawerInjected = false;
let drawerOpen = false;
let drawerFrame = null;
let toggleButton = null;

// Get the video ID from the current URL
function getVideoId() {
  const urlString = window.location.href;
  let videoId = null;

  try {
    const url = new URL(urlString);

    // 1. Standard Watch Page (e.g., youtube.com/watch?v=VIDEO_ID)
    if (url.hostname === "www.youtube.com" && url.pathname === "/watch") {
      videoId = url.searchParams.get("v");
    }
    // 2. Shortened URLs (e.g., youtu.be/VIDEO_ID)
    else if (url.hostname === "youtu.be") {
      videoId = url.pathname.substring(1).split('/')[0];
    }
    // 3. Embedded URLs (e.g., youtube.com/embed/VIDEO_ID)
    else if (url.hostname === "www.youtube.com" && url.pathname.startsWith("/embed/")) {
      const pathParts = url.pathname.split('/');
      if (pathParts.length >= 3) {
        videoId = pathParts[2];
      }
    }
    // 4. Shorts URLs (e.g., youtube.com/shorts/VIDEO_ID)
    else if (url.hostname === "www.youtube.com" && url.pathname.startsWith("/shorts/")) {
      const pathParts = url.pathname.split('/');
      if (pathParts.length >= 3) {
        videoId = pathParts[2];
      }
    }

    // Clean the video ID
    if (videoId) {
      videoId = videoId.split('?')[0];
      videoId = videoId.split('&')[0];
    }

  } catch (e) {
    console.error("Error parsing URL for video ID:", e, "URL:", urlString);
    return null;
  }

  return videoId;
}

// Create and inject the drawer into the page
function injectDrawer() {
  if (drawerInjected) return;
  
  // Create toggle button
  toggleButton = document.createElement('button');
  toggleButton.className = 'comment-pulse-toggle';
  toggleButton.innerHTML = 'CP';
  toggleButton.title = 'Analyze Comments with CommentPulse';
  toggleButton.addEventListener('click', toggleDrawer);
  document.body.appendChild(toggleButton);
  
  // Create drawer iframe
  drawerFrame = document.createElement('iframe');
  drawerFrame.src = chrome.runtime.getURL('drawer.html');
  drawerFrame.className = 'comment-pulse-drawer';
  drawerFrame.style.cssText = `
    position: fixed;
    top: 0;
    right: -400px;
    width: 400px;
    height: 100vh;
    border: none;
    z-index: 9999;
    transition: right 0.3s ease;
    box-shadow: -2px 0 10px rgba(0, 0, 0, 0.2);
  `;
  document.body.appendChild(drawerFrame);
  
  // Inject styles for the toggle button
  const style = document.createElement('style');
  style.textContent = `
    .comment-pulse-toggle {
      position: fixed;
      top: 70px;
      right: 20px;
      background: #1a73e8;
      color: white;
      border: none;
      border-radius: 50%;
      width: 48px;
      height: 48px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
      z-index: 9998;
      transition: transform 0.3s ease;
    }
    .comment-pulse-toggle:hover {
      transform: scale(1.1);
    }
    .comment-pulse-toggle img {
      width: 24px;
      height: 24px;
    }
  `;
  document.head.appendChild(style);
  
  drawerInjected = true;
  
  // Initialize the drawer with the video ID once the iframe is loaded
  drawerFrame.onload = function() {
    const videoId = getVideoId();
    if (videoId) {
      drawerFrame.contentWindow.postMessage({
        source: 'comment-pulse-content',
        action: 'initDrawer',
        videoId: videoId
      }, '*');
    }
  };
}

// Toggle the drawer open/closed
function toggleDrawer() {
  if (drawerOpen) {
    drawerFrame.style.right = '-400px';
    drawerOpen = false;
  } else {
    drawerFrame.style.right = '0';
    drawerOpen = true;
    
    // Send the current video ID to the drawer
    const videoId = getVideoId();
    if (videoId) {
      drawerFrame.contentWindow.postMessage({
        source: 'comment-pulse-content',
        action: 'initDrawer',
        videoId: videoId
      }, '*');
    }
  }
}

// Listen for messages from the extension
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("Content script received message:", request);
  
  if (request.action === 'getVideoId') {
    const videoId = getVideoId();
    console.log("Current Video ID found by content script:", videoId);
    sendResponse({ videoId: videoId });
  } else if (request.action === 'openDrawer') {
    console.log("Opening drawer...");
    if (!drawerInjected) {
      console.log("Injecting drawer first...");
      injectDrawer();
      // Give the drawer time to load before opening it
      setTimeout(() => {
        console.log("Now opening drawer after injection");
        drawerFrame.style.right = '0';
        drawerOpen = true;
        sendResponse({ success: true });
      }, 500);
      return true; // Will respond asynchronously
    } else {
      console.log("Drawer already injected, opening it");
      drawerFrame.style.right = '0';
      drawerOpen = true;
      sendResponse({ success: true });
    }
  } else if (request.action === 'closeDrawer') {
    if (drawerInjected) {
      drawerFrame.style.right = '-400px';
      drawerOpen = false;
    }
    sendResponse({ success: true });
  }
  return true; // Will respond asynchronously
});

// Listen for messages from the drawer iframe
window.addEventListener('message', function(event) {
  // Only accept messages from our drawer iframe
  if (event.data.source !== 'comment-pulse-drawer') return;
  
  if (event.data.action === 'closeDrawer') {
    drawerFrame.style.right = '-400px';
    drawerOpen = false;
  }
});

// Initialize the drawer when the page loads
window.addEventListener('load', function() {
  // Only inject on YouTube video pages
  const url = window.location.href;
  if (url.includes('youtube.com/watch') || url.includes('youtube.com/shorts')) {
    injectDrawer();
  }
});

// Re-inject the drawer when the URL changes (for YouTube's SPA navigation)
let lastUrl = location.href; 
new MutationObserver(() => {
  const url = location.href;
  if (url !== lastUrl) {
    lastUrl = url;
    // Check if we're on a YouTube video page
    if (url.includes('youtube.com/watch') || url.includes('youtube.com/shorts')) {
      if (!drawerInjected) {
        injectDrawer();
      } else {
        // Update the drawer with the new video ID
        const videoId = getVideoId();
        if (videoId) {
          drawerFrame.contentWindow.postMessage({
            source: 'comment-pulse-content',
            action: 'initDrawer',
            videoId: videoId
          }, '*');
        }
      }
    } else {
      // Remove the drawer if we're not on a video page
      if (drawerInjected) {
        if (toggleButton) toggleButton.remove();
        if (drawerFrame) drawerFrame.remove();
        drawerInjected = false;
        drawerOpen = false;
      }
    }
  }
}).observe(document, {subtree: true, childList: true});
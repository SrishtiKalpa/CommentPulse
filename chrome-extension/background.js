// Background script to handle extension icon click

// Listen for extension icon clicks
chrome.action.onClicked.addListener((tab) => {
  // Only run on YouTube tabs
  if (tab.url && (tab.url.includes('youtube.com/watch') || tab.url.includes('youtube.com/shorts'))) {
    // Send a message to the content script to open the drawer
    chrome.tabs.sendMessage(tab.id, { action: 'openDrawer' }, (response) => {
      // Check for any error
      if (chrome.runtime.lastError) {
        console.error('Error sending message:', chrome.runtime.lastError);
        // If content script isn't ready, inject it
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js']
        }).then(() => {
          // Try sending the message again after script is injected
          setTimeout(() => {
            chrome.tabs.sendMessage(tab.id, { action: 'openDrawer' });
          }, 500);
        }).catch(err => {
          console.error('Failed to inject content script:', err);
        });
      }
    });
  } else {
    // If not on a YouTube video page, show an alert
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        alert('Please navigate to a YouTube video to use CommentPulse.');
      }
    }).catch(err => {
      console.error('Failed to show alert:', err);
    });
  }
});

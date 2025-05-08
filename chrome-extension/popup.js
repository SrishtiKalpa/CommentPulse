// Store chart instances so they can be destroyed before creating new ones
let sentimentChart = null;
let engagementChart = null;

document.addEventListener('DOMContentLoaded', () => {
  const analyzeBtn = document.getElementById('analyze-btn');
  const loadingDiv = document.getElementById('loading');
  const errorDiv = document.getElementById('error');
  const contentDiv = document.getElementById('content');
  
  // Get the current tab
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const currentTab = tabs[0];
    
    // Check if we're on YouTube
    if (!currentTab.url.includes('youtube.com/watch')) {
      showError('Please navigate to a YouTube video to analyze comments.');
      analyzeBtn.disabled = true;
      return;
    }
    
    // Get video ID from content script
    chrome.tabs.sendMessage(currentTab.id, { action: 'getVideoId' }, (response) => {
      if (!response || !response.videoId) {
        showError('Could not find video ID. Please make sure you are on a YouTube video page.');
        analyzeBtn.disabled = true;
        return;
      }
      
      // Enable analyze button
      analyzeBtn.disabled = false;
      
      // Add click handler
      analyzeBtn.addEventListener('click', () => analyzeComments(response.videoId));
    });
  });
  
  function showError(message) {
    errorDiv.textContent = message;
    errorDiv.classList.add('active');
    loadingDiv.classList.remove('active');
    contentDiv.style.display = 'none';
  }
  
  function showLoading() {
    errorDiv.classList.remove('active');
    loadingDiv.classList.add('active');
    contentDiv.style.display = 'none';
  }
  
  function showContent() {
    errorDiv.classList.remove('active');
    loadingDiv.classList.remove('active');
    contentDiv.style.display = 'block';
  }
  
  async function analyzeComments(videoId) {
    showLoading();
    
    try {
      // Get API endpoint from environment or default to localhost
      const apiUrl = chrome.runtime.getManifest().host_permissions[0].replace('/*', '') || 'http://localhost:8000';
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
      
      const response = await fetch(`${apiUrl}/analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          video_id: videoId,
          days_back: 7,
          max_comments: 1000
        }),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        // Try to get error details from response
        let errorDetail = '';
        try {
          const errorData = await response.json();
          errorDetail = errorData.detail || '';
        } catch (e) {
          // If we can't parse the JSON, just use the status text
        }
        
        throw new Error(`Server error (${response.status}): ${errorDetail || response.statusText}`);
      }
      
      const data = await response.json();
      displayResults(data);
      showContent();
    } catch (error) {
      console.error('Analysis error:', error);
      
      // Provide more helpful error messages
      if (error.name === 'AbortError') {
        showError('Request timed out. The server might be overloaded, please try again later.');
      } else if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
        showError('Could not connect to the analysis server. Please check if the server is running.');
      } else {
        showError(`Error analyzing comments: ${error.message}`);
      }
    }
  }
  
  function displayResults(data) {
    console.log('API Response:', data); // For debugging
    
    // Update stats
    document.getElementById('total-comments').textContent = data.analysis_results.total_comments;
    document.getElementById('avg-sentiment').textContent = 
      (data.analysis_results.average_sentiment_score * 100).toFixed(1) + '%';
    
    // For top topic, we don't have this in the API response, so display summary instead
    document.getElementById('top-topic').textContent = 'See summary';
    
    document.getElementById('engagement-score').textContent = 
      (data.analysis_results.engagement_rate * 100).toFixed(1) + '%';
    
    // Display summary
    document.getElementById('summary-text').textContent = data.summary || data.analysis_results.summary_paragraph || 'No summary available';
    
    // Extract sentiment distribution
    const sentimentDistribution = data.analysis_results.sentiment_distribution;
    const positive = sentimentDistribution.positive || 0;
    const neutral = sentimentDistribution.neutral || 0;
    const negative = sentimentDistribution.negative || 0;
    const total = positive + neutral + negative || 1; // Avoid division by zero
    
    // Destroy existing sentiment chart if it exists
    if (sentimentChart) {
      sentimentChart.destroy();
    }
    
    // Create sentiment distribution chart
    const sentimentCtx = document.getElementById('sentiment-chart').getContext('2d');
    sentimentChart = new Chart(sentimentCtx, {
      type: 'pie',
      data: {
        labels: ['Positive', 'Neutral', 'Negative'],
        datasets: [{
          data: [
            (positive / total) * 100,
            (neutral / total) * 100,
            (negative / total) * 100
          ],
          backgroundColor: ['#34a853', '#fbbc05', '#ea4335']
        }]
      },
      options: {
        responsive: true,
        plugins: {
          title: {
            display: true,
            text: 'Sentiment Distribution'
          }
        }
      }
    });
    
    // Destroy existing engagement chart if it exists
    if (engagementChart) {
      engagementChart.destroy();
    }
    
    // Since we don't have engagement over time data in the API response,
    // display a simple bar chart with engagement rate
    const engagementCtx = document.getElementById('engagement-chart').getContext('2d');
    engagementChart = new Chart(engagementCtx, {
      type: 'bar',
      data: {
        labels: ['Engagement Rate'],
        datasets: [{
          label: 'Engagement',
          data: [data.analysis_results.engagement_rate],
          backgroundColor: '#1a73e8'
        }]
      },
      options: {
        responsive: true,
        plugins: {
          title: {
            display: true,
            text: 'Engagement Rate'
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            max: 1
          }
        }
      }
    });
    
    // Display visualization images
    const visualizationsGrid = document.getElementById('visualizations-grid');
    visualizationsGrid.innerHTML = ''; // Clear existing content
    
    // Check if visualizations are available
    if (data.visualizations && data.visualizations.length > 0) {
      // Create a proxy URL for each visualization
      data.visualizations.forEach((vizPath, index) => {
        // Create a container for each visualization
        const vizContainer = document.createElement('div');
        vizContainer.style.marginBottom = '20px';
        
        // Create a title for the visualization
        const vizTitle = document.createElement('h4');
        vizTitle.style.margin = '0 0 8px 0';
        
        // Extract the filename from the path
        const filename = vizPath.split('/').pop();
        const prettyName = filename.replace(/_/g, ' ').replace('.png', '');
        vizTitle.textContent = prettyName.charAt(0).toUpperCase() + prettyName.slice(1);
        
        // Create a link to open the visualization in a new tab
        const vizLink = document.createElement('a');
        vizLink.href = `http://localhost:8000/${vizPath}`;
        vizLink.target = '_blank';
        vizLink.textContent = 'Open in new tab';
        vizLink.style.display = 'block';
        vizLink.style.marginBottom = '8px';
        vizLink.style.color = '#1a73e8';
        
        // Create an image element for the visualization
        const vizImage = document.createElement('img');
        vizImage.src = `http://localhost:8000/${vizPath}`;
        vizImage.alt = prettyName;
        vizImage.style.width = '100%';
        vizImage.style.borderRadius = '4px';
        vizImage.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
        
        // Add elements to the container
        vizContainer.appendChild(vizTitle);
        vizContainer.appendChild(vizLink);
        vizContainer.appendChild(vizImage);
        
        // Add the container to the grid
        visualizationsGrid.appendChild(vizContainer);
      });
    } else {
      // Display a message if no visualizations are available
      const noVizMessage = document.createElement('p');
      noVizMessage.textContent = 'No visualizations available';
      visualizationsGrid.appendChild(noVizMessage);
    }
  }
}); 
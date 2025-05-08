# CommentPulse Chrome Extension

A Chrome extension that provides real-time analysis of YouTube video comments using AI-powered insights.

## Features

- Real-time comment analysis for any YouTube video
- Sentiment analysis visualization
- Engagement metrics tracking
- Topic analysis
- Beautiful and intuitive UI

## Installation

1. Make sure the CommentPulse API server is running locally on port 8000
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right corner
4. Click "Load unpacked" and select the `chrome-extension` directory
5. The extension icon should appear in your Chrome toolbar

## Usage

1. Navigate to any YouTube video
2. Click the CommentPulse extension icon in your toolbar
3. Click the "Analyze Comments" button
4. Wait for the analysis to complete
5. View the results in the popup window

## Development

The extension consists of the following files:

- `manifest.json`: Extension configuration
- `popup.html`: Main UI
- `popup.js`: UI logic and API integration
- `content.js`: YouTube page interaction
- `icons/`: Extension icons

## Requirements

- Chrome browser
- CommentPulse API server running on `http://localhost:8000`

## Troubleshooting

If you encounter any issues:

1. Make sure the API server is running
2. Check the browser console for error messages
3. Verify that you're on a valid YouTube video page
4. Try reloading the extension

## License

MIT License 
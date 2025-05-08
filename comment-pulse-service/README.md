# CommentPulse

CommentPulse is a powerful YouTube comment analysis tool that provides AI-powered insights into video comments. It includes a FastAPI backend for analyzing comments and a Chrome extension for easy access to the analysis.

## Features

- **YouTube Comment Analysis**: Fetch and analyze comments from any YouTube video
- **Sentiment Analysis**: Understand the emotional tone of comments
- **Engagement Metrics**: Track likes, engagement rates, and comment patterns
- **Visualizations**: Generate charts and wordclouds to visualize comment data
- **Chrome Extension**: Analyze videos directly from YouTube with a single click
- **Caching**: Store analysis results for quick access to previously analyzed videos

## Project Structure

- `api.py`: FastAPI server that provides the analysis API endpoints
- `comment_analysis_service.py`: Service for analyzing YouTube comments
- `comment_analyzer.py`: Core analysis logic for processing comments
- `youtube_comments_fetcher.py`: Fetches comments from the YouTube API
- `chrome-extension/`: Chrome extension for easy access to the analysis tool

## Setup Instructions

### Prerequisites

- Python 3.8+
- YouTube Data API v3 key
- (Optional) Redis for rate limiting

### Environment Setup

1. Clone the repository
2. Create a virtual environment and activate it:

```bash
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
```

3. Install dependencies:

```bash
pip install -r requirements.txt
```

4. Create a `.env` file based on the provided `.env.example`:

```bash
cp .env.example .env
```

5. Edit the `.env` file and add your YouTube API key:

```
YOUTUBE_API_KEY=your_youtube_api_key_here
```

### Running the API Server

```bash
python api.py
```

The API will be available at `http://localhost:8000`. You can access the API documentation at `http://localhost:8000/docs`.

### Installing the Chrome Extension

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" (toggle in the top right)
3. Click "Load unpacked" and select the `chrome-extension` directory from this project
4. The CommentPulse extension icon should appear in your browser toolbar

## API Endpoints

- `POST /analyze`: Analyze comments for a YouTube video
- `GET /health`: Check API health status
- `DELETE /admin/cache`: Clear the analysis cache (requires API key)

## Security Features

- API key authentication for admin endpoints
- Rate limiting to prevent abuse
- CORS protection
- Error handling and logging

## Production Deployment

For production deployment, consider the following:

1. Use a production WSGI server like Gunicorn
2. Set up Redis for rate limiting
3. Configure proper logging
4. Use environment variables for configuration
5. Set up HTTPS with a valid SSL certificate

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

A Python-based tool for analyzing sentiment in YouTube video comments.

## Features

- Fetches comments from YouTube videos using the YouTube Data API
- Analyzes comment sentiment using NLTK's VADER sentiment analyzer
- Generates sentiment distribution visualizations
- Provides detailed sentiment analysis summaries
- Shows top positive and negative comments

## Setup

1. Clone the repository:
```bash
git clone https://github.com/yourusername/CommentPulse.git
cd CommentPulse
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```

3. Set up your YouTube API key:
   - Get an API key from the [Google Cloud Console](https://console.cloud.google.com/)
   - Enable the YouTube Data API v3
   - Add your API key to the code or set it as an environment variable

## Usage

Run the analysis:
```bash
python run_analysis.py
```

The script will:
1. Fetch comments from the specified YouTube video
2. Analyze the sentiment of each comment
3. Generate a sentiment distribution plot
4. Save detailed results to CSV
5. Print a summary of the analysis

## Output

- `comment_sentiment_analysis.csv`: Detailed results of the sentiment analysis
- `sentiment_distribution.png`: Visualization of sentiment distribution

## Requirements

- Python 3.7+
- See `requirements.txt` for Python package dependencies

## License

MIT License 
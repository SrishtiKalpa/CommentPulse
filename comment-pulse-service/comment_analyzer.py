import pandas as pd
import numpy as np
from typing import Dict, List, Any
from collections import Counter
import re
from nltk.sentiment.vader import SentimentIntensityAnalyzer
import nltk
import matplotlib.pyplot as plt
import seaborn as sns
from wordcloud import WordCloud

# Download required NLTK data
try:
    nltk.data.find('vader_lexicon')
except LookupError:
    nltk.download('vader_lexicon', quiet=True)

class CommentAnalyzer:
    def __init__(self):
        """Initialize the comment analyzer with sentiment analyzer."""
        self.sia = SentimentIntensityAnalyzer()
    
    def analyze_comments(self, comments: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Analyze a list of comments and return comprehensive metrics.
        
        Args:
            comments (List[Dict]): List of comment dictionaries
            
        Returns:
            Dict containing various metrics and insights
        """
        if not comments:
            # Return a properly structured empty result instead of an error
            return {
                "total_comments": 0,
                "unique_authors": 0,
                "total_likes": 0,
                "average_likes_per_comment": 0.0,
                "engagement_rate": 0.0,
                "sentiment_distribution": {"positive": 0, "neutral": 0, "negative": 0},
                "average_sentiment_score": 0.0,
                "summary_paragraph": "No comments found for analysis. The video might have comments disabled, or there may be no comments yet.",
                "visualizations": [],
                "error": "No comments provided for analysis"
            }
        
        # Convert to DataFrame for easier analysis
        df = pd.DataFrame(comments)
        
        # Basic metrics
        metrics = {
            "total_comments": len(comments),
            "unique_authors": df['author'].nunique(),
            "total_likes": df['like_count'].sum(),
            "average_likes_per_comment": df['like_count'].mean(),
            "engagement_rate": (df['like_count'].sum() / len(comments)) if len(comments) > 0 else 0
        }
        
        # Sentiment analysis
        sentiment_metrics = self._analyze_sentiment(df)
        metrics.update(sentiment_metrics)
        
        # Time-based analysis
        time_metrics = self._analyze_timing(df)
        metrics.update(time_metrics)
        
        # Top contributors
        metrics["top_contributors"] = self._get_top_contributors(df)
        
        # Common themes and keywords
        metrics["common_themes"] = self._analyze_themes(df)
        
        # Generate summary paragraph
        metrics["summary_paragraph"] = self.generate_summary_paragraph(metrics)
        
        return metrics
    
    def _analyze_sentiment(self, df: pd.DataFrame) -> Dict[str, Any]:
        """Analyze sentiment of comments."""
        sentiments = []
        for text in df['text']:
            scores = self.sia.polarity_scores(text)
            compound_score = scores['compound']
            if compound_score >= 0.05:
                sentiment = 'Positive'
            elif compound_score <= -0.05:
                sentiment = 'Negative'
            else:
                sentiment = 'Neutral'
            sentiments.append({
                'sentiment': sentiment,
                'compound_score': compound_score,
                'positive_score': scores['pos'],
                'negative_score': scores['neg'],
                'neutral_score': scores['neu']
            })
        
        sentiment_df = pd.DataFrame(sentiments)
        df = pd.concat([df, sentiment_df], axis=1)
        
        return {
            "sentiment_distribution": df['sentiment'].value_counts().to_dict(),
            "average_sentiment_score": df['compound_score'].mean(),
            "top_positive_comments": self._get_top_comments(df, 'compound_score', 5),
            "top_negative_comments": self._get_top_comments(df, 'compound_score', 5, ascending=True),
            "most_liked_comments": self._get_top_comments(df, 'like_count', 5)
        }
    
    def _analyze_timing(self, df: pd.DataFrame) -> Dict[str, Any]:
        """Analyze comment timing patterns."""
        df['published_at'] = pd.to_datetime(df['published_at'])
        df['hour'] = df['published_at'].dt.hour
        df['day'] = df['published_at'].dt.day_name()
        
        return {
            "peak_hours": df['hour'].value_counts().head(3).to_dict(),
            "peak_days": df['day'].value_counts().head(3).to_dict(),
            "comment_frequency": {
                "hourly": df.groupby('hour').size().to_dict(),
                "daily": df.groupby('day').size().to_dict()
            }
        }
    
    def _get_top_contributors(self, df: pd.DataFrame) -> List[Dict[str, Any]]:
        """Get top comment contributors."""
        contributor_stats = df.groupby('author').agg({
            'text': 'count',
            'like_count': 'sum'
        }).reset_index()
        
        contributor_stats.columns = ['author', 'comment_count', 'total_likes']
        contributor_stats['average_likes'] = contributor_stats['total_likes'] / contributor_stats['comment_count']
        
        return contributor_stats.nlargest(5, 'total_likes').to_dict('records')
    
    def _analyze_themes(self, df: pd.DataFrame) -> Dict[str, Any]:
        """Analyze common themes and keywords in comments."""
        # Combine all comments
        all_text = ' '.join(df['text'].astype(str))
        
        # Extract common words (excluding common stop words)
        words = re.findall(r'\b\w+\b', all_text.lower())
        word_freq = Counter(words)
        
        return {
            "common_words": dict(word_freq.most_common(20))
        }
    
    def _get_top_comments(
        self,
        df: pd.DataFrame,
        sort_by: str,
        n: int = 5,
        ascending: bool = False
    ) -> List[Dict[str, Any]]:
        """Get top N comments based on specified criteria."""
        sorted_df = df.nlargest(n, sort_by) if not ascending else df.nsmallest(n, sort_by)
        result = []
        for _, row in sorted_df.iterrows():
            result.append({
                'author': row['author'],
                'text': row['text'],
                'like_count': int(row['like_count']),
                'score': float(row[sort_by])
            })
        return result
    
    def generate_visualizations(self, df: pd.DataFrame, output_dir: str = '.'):
        """Generate various visualizations for the analysis."""
        # Ensure sentiment analysis is done first
        if 'sentiment' not in df.columns:
            sentiments = []
            for text in df['text']:
                scores = self.sia.polarity_scores(text)
                compound_score = scores['compound']
                if compound_score >= 0.05:
                    sentiment = 'Positive'
                elif compound_score <= -0.05:
                    sentiment = 'Negative'
                else:
                    sentiment = 'Neutral'
                sentiments.append({
                    'sentiment': sentiment,
                    'compound_score': compound_score,
                    'positive_score': scores['pos'],
                    'negative_score': scores['neg'],
                    'neutral_score': scores['neu']
                })
            
            sentiment_df = pd.DataFrame(sentiments)
            df = pd.concat([df, sentiment_df], axis=1)
        
        # Sentiment distribution pie chart
        plt.figure(figsize=(10, 6))
        df['sentiment'].value_counts().plot(kind='pie', autopct='%1.1f%%')
        plt.title('Comment Sentiment Distribution')
        plt.savefig(f'{output_dir}/sentiment_distribution.png')
        plt.close()
        
        # Engagement over time
        plt.figure(figsize=(12, 6))
        df['published_at'] = pd.to_datetime(df['published_at'])
        engagement_over_time = df.set_index('published_at')['like_count'].resample('D').sum()
        engagement_over_time.plot()
        plt.title('Comment Engagement Over Time')
        plt.xlabel('Date')
        plt.ylabel('Total Likes')
        plt.savefig(f'{output_dir}/engagement_over_time.png')
        plt.close()
        
        # Hourly activity heatmap
        plt.figure(figsize=(12, 6))
        df['hour'] = df['published_at'].dt.hour
        df['day'] = df['published_at'].dt.day_name()
        hourly_activity = pd.crosstab(df['day'], df['hour'])
        sns.heatmap(hourly_activity, cmap='YlOrRd')
        plt.title('Comment Activity Heatmap')
        plt.savefig(f'{output_dir}/activity_heatmap.png')
        plt.close()
        
        # Word cloud
        all_text = ' '.join(df['text'].astype(str))
        wordcloud = WordCloud(width=800, height=400, background_color='white').generate(all_text)
        plt.figure(figsize=(10, 5))
        plt.imshow(wordcloud, interpolation='bilinear')
        plt.axis('off')
        plt.savefig(f'{output_dir}/wordcloud.png')
        plt.close()

    def generate_summary_paragraph(self, metrics: Dict[str, Any]) -> str:
        """
        Generate a concise summary paragraph of the comment analysis.
        
        Args:
            metrics (Dict): Analysis metrics dictionary
            
        Returns:
            str: A human-readable summary paragraph
        """
        # Extract key metrics
        total_comments = metrics['total_comments']
        unique_authors = metrics['unique_authors']
        total_likes = metrics['total_likes']
        sentiment_dist = metrics['sentiment_distribution']
        avg_sentiment = metrics['average_sentiment_score']
        peak_day = max(metrics['peak_days'].items(), key=lambda x: x[1])[0]
        peak_hour = max(metrics['peak_hours'].items(), key=lambda x: x[1])[0]
        top_contributor = metrics['top_contributors'][0]
        common_words = list(metrics['common_themes']['common_words'].keys())[:5]
        
        # Generate concise single-paragraph summary
        concise_summary = f"""Quick Summary:
The video has generated significant engagement with {total_comments:,} comments from {unique_authors:,} unique viewers, accumulating {total_likes:,} total likes. The community shows a balanced sentiment distribution with {sentiment_dist.get('Positive', 0):,} positive, {sentiment_dist.get('Neutral', 0):,} neutral, and {sentiment_dist.get('Negative', 0):,} negative comments. Engagement peaks on {peak_day}s at {peak_hour}:00, with the most active contributor {top_contributor['author']} receiving {top_contributor['total_likes']:,} likes. The discussion primarily revolves around topics related to {', '.join(common_words)}."""

        # Generate detailed summary with better formatting
        detailed_summary = f"""

Detailed Analysis
================

Engagement Overview:
------------------
• Total Comments: {total_comments:,}
• Unique Viewers: {unique_authors:,}
• Total Likes: {total_likes:,}
• Average Likes per Comment: {metrics['average_likes_per_comment']:.1f}

Sentiment Analysis:
-----------------
• Positive Comments: {sentiment_dist.get('Positive', 0):,}
• Neutral Comments: {sentiment_dist.get('Neutral', 0):,}
• Negative Comments: {sentiment_dist.get('Negative', 0):,}
• Overall Sentiment Score: {avg_sentiment:.2f}

Peak Engagement:
--------------
• Most Active Day: {peak_day}
• Peak Hour: {peak_hour}:00

Top Contributor:
--------------
• Author: {top_contributor['author']}
• Total Likes: {top_contributor['total_likes']:,}
• Comments: {top_contributor['comment_count']:,}

Common Themes:
------------
• Top Keywords: {', '.join(common_words)}

Note: This analysis is based on {total_comments:,} comments collected from the video.
"""
        return concise_summary + detailed_summary

#!/usr/bin/env python3

import sqlite3
import pandas as pd
from prophet import Prophet
from datetime import datetime, timedelta
import traceback

# --- Configuration ---
DB_FILE = 'hotspot_usage.db'
# We will aggregate data into 15-minute chunks
AGGREGATION_MINUTES = 15
# We will train on the last 14 days of data
TRAIN_DAYS = 14
# We will predict 48 hours into the future
PREDICT_HOURS = 48

def init_db():
    """
    Ensures the necessary tables exist.
    """
    print(f"Initializing database at {DB_FILE}...")
    conn = None
    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        
        # This table stores the clean, aggregated data for training
        cursor.execute('''
        CREATE TABLE IF NOT EXISTS usage_summary (
            timestamp TEXT PRIMARY KEY, -- UTC, e.g., '2025-11-01 14:00:00'
            total_rx_bytes INTEGER,
            total_tx_bytes INTEGER
        )''')
        
        # This table stores the model's predictions
        cursor.execute('''
        CREATE TABLE IF NOT EXISTS usage_forecast (
            timestamp TEXT PRIMARY KEY,
            predicted_bytes REAL,
            predicted_lower REAL, -- Confidence interval
            predicted_upper REAL  -- Confidence interval
        )''')
        
        conn.commit()
    except Exception as e:
        print(f"DB Init Error: {e}")
        traceback.print_exc()
    finally:
        if conn: conn.close()
    print("Database tables ensured.")


def aggregate_data():
    """
    Reads the raw 'data_log' and aggregates it into 15-minute summaries
    in the 'usage_summary' table.
    """
    print(f"Starting data aggregation for last {TRAIN_DAYS} days...")
    conn = None
    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        
        # Find the last timestamp we have in the summary table
        cursor.execute("SELECT MAX(timestamp) FROM usage_summary")
        last_summary_ts = cursor.fetchone()[0]
        
        start_date_str = None
        if last_summary_ts:
            start_date_str = last_summary_ts
        else:
            # If no data, just start from 14 days ago
            start_date = datetime.now() - timedelta(days=TRAIN_DAYS)
            start_date_str = start_date.strftime('%Y-%m-%d %H:%M:%S')

        print(f"Aggregating raw data from: {start_date_str}")
        
        # Query the raw log
        # We use strftime to 'floor' the timestamps to the nearest 15-minute mark
        query = f"""
        SELECT
            strftime('%Y-%m-%d %H:', timestamp) || 
            PRINTF('%02d', (CAST(strftime('%M', timestamp) AS INTEGER) / {AGGREGATION_MINUTES}) * {AGGREGATION_MINUTES}) || 
            ':00' AS timeslot,
            SUM(rx_bytes) AS total_rx,
            SUM(tx_bytes) AS total_tx
        FROM 
            data_log
        WHERE 
            timestamp > ?
        GROUP BY 
            timeslot
        HAVING
            total_rx > 0 OR total_tx > 0
        ORDER BY 
            timeslot
        """
        
        cursor.execute(query, (start_date_str,))
        rows = cursor.fetchall()

        if not rows:
            print("No new raw data to aggregate.")
            return

        # Insert or Replace the aggregated data
        print(f"Found {len(rows)} new aggregated time slots. Saving to 'usage_summary'...")
        cursor.executemany(
            "REPLACE INTO usage_summary (timestamp, total_rx_bytes, total_tx_bytes) VALUES (?, ?, ?)",
            rows
        )
        conn.commit()
        print("Aggregation complete.")
        
    except Exception as e:
        print(f"Error during aggregation: {e}")
        traceback.print_exc()
    finally:
        if conn:
            conn.close()

def train_and_forecast():
    """
    Trains the Prophet model on the 'usage_summary' table
    and saves the forecast to the 'usage_forecast' table.
    """
    print("\nStarting model training...")
    conn = None
    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        
        # Load aggregated data for training
        # We rename columns to 'ds' (timestamp) and 'y' (value) as Prophet requires
        start_date = (datetime.now() - timedelta(days=TRAIN_DAYS)).strftime('%Y-%m-%d %H:%M:%S')
        df = pd.read_sql_query(
            "SELECT timestamp as ds, total_rx_bytes as y FROM usage_summary WHERE timestamp > ?", 
            conn,
            params=(start_date,)
        )

        if len(df) < 100: # Need a minimum amount of data to train
            print(f"Not enough data to train (found {len(df)} points). Need at least 100.")
            print("Run your hotspot for a day or two and try again.")
            return

        print(f"Training Prophet model with {len(df)} data points...")
        
        # Train the Prophet model
        # Prophet will automatically find daily and weekly patterns (seasonality)
        m = Prophet(daily_seasonality=True, weekly_seasonality=True)
        m.fit(df)
        
        print("Training complete. Generating forecast...")

        # Generate the forecast
        periods_to_predict = int((PREDICT_HOURS * 60) / AGGREGATION_MINUTES)
        freq_str = f'{AGGREGATION_MINUTES}min' # e.g., '15min'
        
        future_df = m.make_future_dataframe(periods=periods_to_predict, freq=freq_str)
        forecast_df = m.predict(future_df)
        
        # Save the forecast to the database
        now_str = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        future_forecast = forecast_df[forecast_df['ds'] > now_str][['ds', 'yhat', 'yhat_lower', 'yhat_upper']]
        
        # Ensure 'yhat' (prediction) is never negative
        future_forecast['yhat'] = future_forecast['yhat'].apply(lambda x: max(0, x))
        future_forecast['yhat_lower'] = future_forecast['yhat_lower'].apply(lambda x: max(0, x))
        future_forecast['yhat_upper'] = future_forecast['yhat_upper'].apply(lambda x: max(0, x))

        print(f"Saving {len(future_forecast)} new forecast points to DB...")
        
        rows_to_insert = [
            (row['ds'].strftime('%Y-%m-%d %H:%M:%S'), row['yhat'], row['yhat_lower'], row['yhat_upper'])
            for index, row in future_forecast.iterrows()
        ]
        
        # Clear old forecast and insert new one
        cursor.execute("DELETE FROM usage_forecast")
        cursor.executemany(
            "REPLACE INTO usage_forecast (timestamp, predicted_bytes, predicted_lower, predicted_upper) VALUES (?, ?, ?, ?)",
            rows_to_insert
        )
        conn.commit()
        print("Forecast saved successfully.")
        
    except Exception as e:
        print(f"Error during training/forecasting: {e}")
        traceback.print_exc()
    finally:
        if conn:
            conn.close()

def prune_old_logs():
    """
    Deletes raw log entries from 'data_log' that are older
    than the training period (e.g., 14 days).
    """
    print("\nPruning old raw logs from data_log...")
    conn = None
    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        
        # Delete all entries older than 14 days
        cursor.execute(f"DELETE FROM data_log WHERE timestamp < date('now', '-{TRAIN_DAYS} days')")
        
        # This reclaims the disk space in the SQLite file
        print("Reclaiming disk space (VACUUM)...")
        cursor.execute("VACUUM") 
        
        conn.commit()
        print("Old logs pruned and database vacuumed.")
    except Exception as e:
        print(f"Error during log pruning: {e}")
    finally:
        if conn:
            conn.close()

if __name__ == "__main__":
    init_db()            # 1. Make sure tables exist
    aggregate_data()     # 2. Summarize new raw data
    train_and_forecast() # 3. Re-train and save new forecast
    prune_old_logs()     # 4. Clean up old raw data
    print(f"\nModel training, forecasting, and pruning complete. ({datetime.now()})")
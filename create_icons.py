#!/usr/bin/env python3
"""
Simple icon generator for WiFi Hotspot Manager
Creates app icon and tray icon with a WiFi symbol
"""

from PIL import Image, ImageDraw
import os

def create_icons():
    # Create assets folder
    os.makedirs('assets', exist_ok=True)
    
    # Main app icon (512x512)
    print("Creating main icon (512x512)...")
    img = Image.new('RGBA', (512, 512), color=(14, 165, 233, 255))
    draw = ImageDraw.Draw(img)
    
    # Draw WiFi waves (white)
    center_x, center_y = 256, 380
    
    # Bottom dot
    draw.ellipse([center_x-20, center_y-20, center_x+20, center_y+20], 
                 fill='white')
    
    # Small wave
    draw.arc([center_x-60, center_y-120, center_x+60, center_y], 
             180, 360, fill='white', width=25)
    
    # Medium wave
    draw.arc([center_x-120, center_y-220, center_x+120, center_y], 
             180, 360, fill='white', width=25)
    
    # Large wave
    draw.arc([center_x-180, center_y-320, center_x+180, center_y], 
             180, 360, fill='white', width=25)
    
    # Add clock hands (for hotspot manager theme)
    # Hour hand
    draw.line([256, 180, 256, 256], fill='white', width=15)
    # Minute hand
    draw.line([256, 256, 330, 256], fill='white', width=15)
    # Center dot
    draw.ellipse([246, 246, 266, 266], fill='white')
    
    img.save('assets/icon.png')
    print("✓ Created assets/icon.png")
    
    # Tray icon (32x32)
    print("Creating tray icon (32x32)...")
    tray = img.resize((32, 32), Image.LANCZOS)
    tray.save('assets/tray-icon.png')
    print("✓ Created assets/tray-icon.png")
    
    # Windows ICO (multiple sizes)
    print("Creating Windows icon (.ico)...")
    sizes = [(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    img.save('assets/icon.ico', sizes=sizes)
    print("✓ Created assets/icon.ico")
    
    print("\n✅ All icons created successfully!")
    print("\nIcon files:")
    print("  - assets/icon.png (512x512) - Main app icon")
    print("  - assets/tray-icon.png (32x32) - System tray icon")
    print("  - assets/icon.ico - Windows icon")

if __name__ == "__main__":
    try:
        create_icons()
    except ImportError:
        print("❌ PIL (Pillow) not found.")
        print("Install it with: pip install pillow")
        exit(1)
    except Exception as e:
        print(f"❌ Error: {e}")
        exit(1)
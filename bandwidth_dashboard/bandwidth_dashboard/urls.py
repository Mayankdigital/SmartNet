from django.contrib import admin
from django.urls import path, include

# 1. ADD THIS IMPORT
from django.contrib.staticfiles.urls import staticfiles_urlpatterns

urlpatterns = [
    path('admin/', admin.site.urls),
    path('', include('monitor.urls')),
]

# 2. ADD THIS LINE AT THE BOTTOM
urlpatterns += staticfiles_urlpatterns()
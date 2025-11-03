from django.urls import path
from . import views
from . import consumers

urlpatterns = [
    # HTTP URL
    path('', views.index, name='index'),
]

websocket_urlpatterns = [
    # WebSocket URL
    path('ws/network/', consumers.NetworkConsumer.as_asgi()),
]
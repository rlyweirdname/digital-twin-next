# Bản sao số Phòng Thông minh
### Dashboard Giám sát & Điều khiển Thời gian thực

---

## 1. Giới thiệu

**"Đây là Bản sao số Phòng Thông minh - một dashboard giám sát và điều khiển phòng trong thời gian thực, kết nối với mô hình 3D."**

- Demo dashboard điều khiển thông minh
- Kết hợp visualization 3D tương tác
- Hoạt động real-time

---

## 2. Demo Trực tiếp

### 2.1 Điều khiển Nhiệt độ

- **Slider**: Kéo để đặt nhiệt độ mục tiêu (20°C - 50°C)
- **Chế độ Tự động**: Hệ thống tự động bật/tắt quạt & điều hòa theo mục tiêu
- **Chế độ Thủ công**: Người dùng kiểm soát từng thiết bị riêng lẻ

> *"Ví dụ: Đặt 22°C, hệ thống tự bật điều hòa và quạt cho đến khi đạt mục tiêu."*

### 2.2 Giám sát

| Chỉ số | Mô tả |
|--------|-------|
| Nhiệt độ hiện tại | Cập nhật liên tục |
| Độ ẩm | Theo dõi real-time |
| Quạt / Điều hòa | Trạng thái BẬT/TẮT |
| Biểu đồ 24h | Nhiệt độ theo thời gian |

> *"Toàn bộ dữ liệu được cập nhật tự động và lưu vào database."*

### 2.3 Mô hình 3D (Spline)

- **Cutaway tự động**: Tường ẩn đi khi camera tiến gần → nhìn thấy nội thất bên trong
- **Toggle Đèn**: Bật/tắt → thấy thay đổi ánh sáng trong 3D
- **Toggle TV**: Bật/tắt → thấy màn hình sáng/tối

> *"Tương tác trực tiếp với mô hình 3D, không cần rời khỏi dashboard."*

---

## 3. Kiến trúc Kỹ thuật

```
┌─────────────────────────────────────────────┐
│                 Frontend                     │
│  Next.js 16 + React + TypeScript + Spline   │
└─────────────────────┬───────────────────────┘
                      │ HTTP API
┌─────────────────────▼───────────────────────┐
│                Backend                       │
│  Next.js API Routes (GET/PUT/POST/DELETE)   │
└─────────────────────┬───────────────────────┘
                      │
┌─────────────────────▼───────────────────────┐
│                 Database                     │
│  SQLite (logs, state)                        │
└─────────────────────────────────────────────┘
```

### Stack công nghệ

| Layer | Công nghệ | Vai trò |
|-------|-----------|---------|
| Frontend | Next.js 16, React | UI components |
| Styling | CSS Variables, Backdrop blur | Giao diện dark mode |
| 3D | Spline Runtime | Mô hình phòng 3D |
| API | Next.js API Routes | CRUD operations |
| Database | SQLite | Lưu logs & state |
| Font | Be Vietnam Pro, JetBrains Mono | Typography tiếng Việt |

### API Endpoints

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| GET | `/api/state` | Lấy trạng thái hiện tại |
| PUT | `/api/state` | Cập nhật trạng thái |
| GET | `/api/logs` | Lấy lịch sử logs |
| POST | `/api/logs` | Tạo log entry |
| DELETE | `/api/logs` | Xóa logs |
| GET | `/api/logs/stats` | Thống kê 24h |

---

## 4. Tính năng Nổi bật

- [x] **Real-time simulation**: Nhiệt độ thay đổi tự động theo thời gian
- [x] **Dual control modes**: Tự động và thủ công
- [x] **Interactive 3D**: Cutaway, light/TV toggle
- [x] **Historical data**: Biểu đồ 24h, thống kê chi tiết
- [x] **Vietnamese UI**: Giao diện tiếng Việt hoàn chỉnh

---

## 5. Hướng phát triển

1. **IoT Integration**: Kết nối MQTT broker, ESP32 devices
2. **Home Assistant**: Tích hợp smart home ecosystem
3. **Multi-room**: Hỗ trợ nhiều phòng
4. **Alert system**: Thông báo khi nhiệt độ vượt ngưỡng
5. **Authentication**: Đăng nhập, phân quyền người dùng

---

## 6. Kết luận

**"Dự án demo khả năng tích hợp IoT dashboard với visualization 3D. Kiến trúc modular, dễ mở rộng sang các hệ thống thực tế như Home Assistant, MQTT, hay các thiết bị IoT."**

---

*Cảm ơn!*

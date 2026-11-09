# Đồng Điệu – Think Alike

Website minigame đoán từ dành cho hai người chơi. Mỗi lượt có 10 giây, mỗi người nhập một cụm gồm 2 hoặc 3 tiếng. Khi hai cụm từ giống nhau (không phân biệt hoa/thường, vẫn giữ dấu tiếng Việt), ván chơi kết thúc.

## Công nghệ
- React + Vite
- Tailwind CSS (kết hợp CSS riêng)
- Supabase PostgreSQL + RPC + polling đồng bộ trạng thái (1,8 giây)
- Vercel hosting

## Chạy giao diện
Yêu cầu Node.js 20+.

```bash
npm install
npm run dev
```

Mở địa chỉ hiển thị trong terminal. Nếu chưa cấu hình Supabase, website chạy ở **chế độ xem trước giao diện**. Chế độ này không giả lập multiplayer: không thể kết nối hai thiết bị với nhau.

## Bật chơi online bằng Supabase
1. Tạo project miễn phí tại https://supabase.com/.
2. Mở **SQL Editor** trong project.
3. Dán và chạy toàn bộ nội dung `supabase/migrations/001_game.sql`.
4. Vào **Project Settings → API**. Sao chép Project URL và anon/public key.
5. Tạo file `.env` ở thư mục gốc, dựa trên `.env.example`:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```

6. Khởi động lại `npm run dev`.
7. Mở hai trình duyệt/thiết bị khác nhau, tạo phòng ở thiết bị thứ nhất, gửi mã/link mời sang thiết bị thứ hai.

**Lưu ý:** Không đưa `service_role` key vào frontend. Chỉ sử dụng anon/public key. Các thao tác game được thực hiện qua RPC `SECURITY DEFINER`; token phiên người chơi được lưu dạng SHA-256 trong database. Các từ chưa được công bố chỉ được trả về qua `get_room_state` sau khi lượt đã chốt.

## Deploy miễn phí lên Vercel
1. Đưa thư mục dự án lên GitHub repository riêng.
2. Đăng nhập https://vercel.com/ và chọn **Add New → Project**.
3. Import repository.
4. Framework preset: Vite; Build command: `npm run build`; Output directory: `dist`.
5. Trong Environment Variables, thêm `VITE_SUPABASE_URL` và `VITE_SUPABASE_ANON_KEY`.
6. Deploy. Vercel sẽ cấp URL công khai. Link mời sẽ tự động dùng domain đang triển khai.

## Luật và hành vi
- Chấp nhận 2 hoặc 3 tiếng, chữ cái Unicode; không chấp nhận dấu câu/số.
- Chuẩn hóa Unicode NFC, gộp khoảng trắng, trim và chuyển chữ thường theo locale tiếng Việt.
- Giữ nguyên dấu tiếng Việt.
- Người gửi chỉ được gửi một lần trong mỗi lượt.
- Hết 10 giây, người chưa gửi bị tính bỏ lượt; game tự chuyển lượt khi client gọi RPC hết hạn. Server kiểm tra timestamp, nên gửi từ trễ bị từ chối.
- Nếu cả hai gửi đủ trước hạn, hệ thống so sánh và chuyển lượt/kết thúc ngay.

## Cấu trúc
```
src/
  lib/game.js          # chuẩn hóa và kiểm tra cụm từ
  lib/supabase.js      # kết nối Supabase
  main.jsx             # luồng màn hình và game
  style.css            # giao diện responsive
supabase/migrations/
  001_game.sql         # schema, RPC, RLS/grants
```

## Ghi chú vận hành
- Supabase free có giới hạn tài nguyên và có thể tạm dừng project không hoạt động trong thời gian dài; kiểm tra chính sách gói hiện hành trước khi phát hành rộng.
- Hệ thống hiện dùng polling dự phòng 1,8 giây để lấy trạng thái phòng, để đồng bộ trạng thái phòng giữa hai thiết bị. Với game bạn bè quy mô nhỏ, cách này đủ nhẹ; có thể chuyển sang Broadcast/Edge Function nếu cần độ trễ thấp hơn.
- Trình duyệt của người chơi cần còn mở để gọi `finish_expired_round` khi hết thời gian. Nếu cả hai đóng trang đúng thời điểm hết lượt, trạng thái có thể chờ đến lần truy cập tiếp theo mới được chốt; không ảnh hưởng khả năng từ trễ bị từ chối ở server.

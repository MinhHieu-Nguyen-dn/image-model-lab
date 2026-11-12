# Image Model Lab

[English](README.md) · **Tiếng Việt**

Studio chạy local để so sánh các mô hình tạo ảnh cạnh nhau. Viết một prompt, chọn nhiều mô hình, rồi xem ảnh của từng mô hình cùng latency, kích thước, usage và chi phí ước tính. Hiện tại hỗ trợ các mô hình Qwen Image trên [Alibaba Cloud Model Studio](https://www.alibabacloud.com/help/en/model-studio/); các nhà cung cấp khác (OpenAI GPT Image, v.v.) nằm trong [roadmap](#roadmap).

Mọi thứ chạy trên máy bạn: server Bun chỉ lắng nghe `127.0.0.1`, một file SQLite, và giao diện JavaScript thuần, không cần build, không dùng CDN. Dữ liệu nằm trong `./images/` và không gửi đi đâu ngoài endpoint mô hình mà bạn cấu hình.

## Tính năng

- **Project và task** để tổ chức thí nghiệm; mọi thứ được lưu lại sau khi khởi động lại.
- **Credentials** (endpoint + API key) dùng chung toàn cục hoặc ghi đè theo từng project, có kiểm tra kết nối không tốn phí khi lưu.
- **So sánh song song**: một task chạy cùng input trên một hay nhiều mô hình cùng lúc. Một mô hình lỗi không ảnh hưởng các mô hình còn lại.
- **Thống kê theo mô hình**: latency, request id, kích thước thực, dung lượng file, số ảnh, seed, prompt đã được viết lại, usage thô và chi phí ước tính.
- **Ảnh tham chiếu có thứ tự** với `@` trong prompt, template chỉnh được (`image 1`, `image 2`, …) và bảng "View request" hiển thị đúng payload gửi đi.
- **Catalog mô hình chỉnh được**: model id của API, giá mỗi ảnh, giới hạn ảnh tham chiếu, hỗ trợ negative prompt.
- **History**: toàn bộ ảnh của mọi project, lọc theo project, task, model, prompt-extend và đánh giá; like/dislike (cũng bấm `l` / `k` trong trình xem); chuyển ảnh bằng phím mũi tên; tải một file ZIP chứa các ảnh đang lọc.

Catalog mặc định: Qwen Image 3.0, 3.0 Pro, 2.1 Pro và 2.1 Turbo. Sửa trong UI để thêm hoặc đổi tên mô hình.

## Bắt đầu nhanh

Cần [Bun](https://bun.sh) 1.3 trở lên.

```bash
bun install
bun start
```

Mở <http://127.0.0.1:4173>, bấm **Global settings**, nhập endpoint và API key của Model Studio. Endpoint có thể là host trần như `ws-<id>.ap-southeast-1.maas.aliyuncs.com` hoặc base URL kết thúc bằng `/api/v1` hay `/compatible-mode/v1`; đường dẫn generation sẽ được tự thêm.

Chưa có key? Thử giao diện với mock server đi kèm:

```bash
bun run mock        # http://127.0.0.1:4199, API key: good-key
```

Sau đó đặt endpoint là `http://127.0.0.1:4199`.

## Cấu hình

| Biến         | Mặc định   | Ý nghĩa                              |
| ------------ | ---------- | ------------------------------------ |
| `PORT`       | `4173`     | Cổng trên `127.0.0.1`                |
| `IMAGES_DIR` | `./images` | Nơi lưu toàn bộ dữ liệu              |
| `PUBLIC_DIR` | `./public` | File giao diện được phục vụ cho UI   |

Cấu trúc dữ liệu: `images/studio.db` (SQLite), `images/credentials.json` (mode `0600`), `images/projects/<project>/tasks/<task>/…` (ảnh tham chiếu và ảnh sinh ra).

## Phát triển

```bash
bun test            # test API chạy với mock Model Studio trong cùng process
bun run typecheck
```

Code backend ở `src/server/`, frontend ở `public/`. Xem [CONTRIBUTING.md](CONTRIBUTING.md).

## Lưu ý bảo mật

Đây là công cụ local cho một người dùng, không phải dịch vụ hosting. Server chỉ lắng nghe loopback, từ chối `Host` và `Origin` lạ, và che API key trong mọi response. Key được lưu dạng văn bản thường trong `images/credentials.json` (chỉ bạn đọc được), nên đừng commit hay chia sẻ thư mục `images/`, và đừng mở cổng ra mạng. Cách báo lỗ hổng: xem [SECURITY.md](SECURITY.md).

## Roadmap

Mục tiêu tiếp theo là hỗ trợ nhiều nhà cung cấp sau một interface chung, để mọi task có thể so sánh mô hình giữa các hãng.

| Giai đoạn | Mục tiêu                                                                                      | Trạng thái |
| --------- | --------------------------------------------------------------------------------------------- | ---------- |
| 0         | Alibaba Cloud Model Studio (Qwen Image)                                                       | Xong       |
| 1         | Trừu tượng hoá provider: đưa Model Studio vào sau interface `ImageProvider`, không đổi hành vi | Dự kiến    |
| 2         | UI theo provider: credentials riêng từng provider, tham số theo khả năng của từng mô hình     | Dự kiến    |
| 3         | **OpenAI GPT Image** (generate và edit, kết quả base64, chi phí tính theo token)              | Dự kiến    |
| 4         | Thêm provider: Google Gemini image, ByteDance Seedream, Black Forest Labs FLUX, Stability AI, endpoint tương thích OpenAI bất kỳ | Ý tưởng    |
| 5         | Job bất đồng bộ, huỷ lượt chạy, chi phí theo token cho mọi provider, import/export            | Ý tưởng    |

Chi tiết thiết kế, interface đề xuất và kế hoạch di chuyển theo từng file nằm ở [docs/roadmap.md](docs/roadmap.md) (tiếng Anh). Rất hoan nghênh yêu cầu và đóng góp provider mới.

## Giấy phép

[MIT](LICENSE)

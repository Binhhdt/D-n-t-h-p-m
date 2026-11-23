# Mô hình tách giọng hát

Bản 1.2 dùng **UVR-MDX-NET-Inst_Main** của nhóm Ultimate Vocal Remover (UVR), theo giấy phép MIT và yêu cầu ghi nguồn của nhóm. Bản đóng gói giữ nguyên trọng số và đổi chiều thời gian từ 256 xuống 96 khung để giới hạn bộ nhớ. Có thể tạo lại bằng `python tools/prepare_mdx.py path/to/UVR-MDX-NET-Inst_Main.onnx` với `onnx==1.19.1`. [Mô hình nguồn](https://github.com/k2-fsa/sherpa-onnx/releases/download/source-separation-models/UVR-MDX-NET-Inst_Main.onnx) · [UVR và giấy phép](https://github.com/Anjok07/ultimatevocalremovergui#license)

- Kích thước ONNX 52.787.031 byte. SHA-256 `022c3c149be3a2203ff352b331f4a443fab12b2d95ccbe7aad021a1fd2637c46`.
- Android đóng gói trọng số và ONNX Runtime 1.22.0. Web hỏi trước khi tải trọng số và tái sử dụng từ Cache Storage nếu trình duyệt cấp chỗ lưu. Web tải runtime WASM từ CDN.
- Mô hình dự đoán phổ phức của nhạc nền ở 44,1 kHz. Ứng dụng tái tạo từng kênh qua iSTFT và ghép chồng lấn khoảng 0,37 giây. Vocal nhận phần còn lại của bản phối.
- Suy luận một tensor 96 khung bằng ONNX Runtime CPU trên Linux chiếm khoảng 371 MiB RSS đỉnh trong phép thử độc lập. Android kiểm tra bộ nhớ khả dụng trước khi chạy và dự trù 400 MiB cho mô hình. Ba bản PCM stereo chiếm khoảng 1,06 MB mỗi giây, ngoài phần dự trù cho giải mã và xuất file.

## So sánh chất lượng tách

Open-Unmix HQ của bản 1.1 dự đoán biên độ vocal và tái sử dụng pha của bản phối. Phần vocal mà mô hình dự đoán thiếu còn lại trong nhạc nền. Kiểm thử phổ phức giữ nguyên khôi phục PCM mono và stereo với sai số cực đại dưới `5e-6`, kể cả qua mối nối giữa các đoạn.

Bảng đo các đoạn stereo 10 giây có vocal và nhạc nền tham chiếu. Rò giọng đo năng lượng thành phần vocal hồi quy trong instrumental so với thành phần nhạc, số âm hơn là tốt hơn. SI-SDR của instrumental đo sai lệch tổng thể so với nhạc nền gốc, số cao hơn là tốt hơn. Số dư sau khi hồi quy hai stem giúp theo dõi méo, màu âm sai khác và các lỗi còn lại.

| Đoạn tham chiếu | Rò giọng 1.1 → 1.2 (dB) | SI-SDR 1.1 → 1.2 (dB) |
| --- | ---: | ---: |
| Bésame Mucho, Bolero Latin | −22,83 → −30,50 | 9,33 → 14,91 |
| Slow Dancing in a Burning Room, rock chậm | −11,04 → −15,39 | 6,69 → 8,96 |
| This Ain’t a Love Song, rock ballad | −14,78 → −23,37 | 6,29 → 12,88 |
| What Have You Done to Me, bản đo tăng vocal 6 dB trước khi đặt gain chung | −18,65 → −31,56 | 9,68 → 14,65 |
| Directions, đoạn vốn ít rò giọng | −31,49 → −30,65 | 19,81 → 20,15 |
| Cur An Long Ag Seol | −24,11 → −25,70 | 14,47 → 14,27 |

Các đoạn Bolero và rock dùng stem nghe thử công khai của những bản thu lại có guitar, piano hoặc keyboard và dây. Các đoạn còn lại lấy từ MUSDB18. Trên 11 đoạn, cải thiện trung vị là 7,67 dB về rò giọng và 2,80 dB về SI-SDR. Các đoạn *Directions* và *Cur An Long Ag Seol* cho thấy cải thiện tùy bài. Trên WAV xuất từ Chromium của đoạn *Schoolboy Facination* dài 12 giây, rò giọng giảm từ −15,20 xuống −22,55 dB và SI-SDR tăng từ 9,80 lên 12,37 dB. [MUSDB18](https://sigsep.github.io/datasets/musdb.html) · [Bolero](https://backtracks4all.com/backingtracks/1940s-standards/besame-mucho-spanish-vocal) · [Rock chậm](https://backtracks4all.com/backingtracks/john-mayer/slow-dancing-in-a-burning-room) · [Rock ballad](https://backtracks4all.com/backingtracks/bon-jovi/this-ain-t-a-love-song)

Bài thử vibrato ghép hai đoạn thu cách ly `m4_caro_vibrato.wav` và `f9_caro_vibrato.wav` với nhạc nền tham chiếu của *Bésame Mucho*, đặt hai stem cùng RMS. Rò giọng giảm từ −19,02 xuống −39,41 dB ở giọng nam và từ −24,63 xuống −40,44 dB ở giọng nữ. Đây là hai hỗn hợp kiểm soát độc lập với bảng 11 đoạn. Các đoạn hát trong bài có phân vị F0 đo được xuống khoảng 83 Hz và lên khoảng 523 Hz. [VocalSet](https://doi.org/10.5281/zenodo.1442513)

Ở một mẫu chỉ có nhạc nền, năng lượng bị gán nhầm sang vocal tăng từ −41,22 lên −29,45 dB so với phần instrumental. Mẫu chỉ có vocal tăng độ cách ly từ 18,47 lên 33,15 dB. Các phép đo này và kiểm tra chức năng phát ở Chromium vẫn cần bổ sung đánh giá nghe A/B có người chấm và đo trên Android thật.

Đối chiếu ba cấu hình khác trên *Schoolboy Facination* và *What Have You Done to Me* cho thấy rò giọng của MDX-Net HQ 3 lần lượt là −24,15 và −33,14 dB, của Demucs v4 là −23,70 và −27,51 dB, còn của Inst_Main 96 khung là −24,09 và −30,71 dB. HQ 3 nguyên bản 256 khung và Demucs v4 qua PyTorch cần nhiều bộ nhớ hơn trong các phép thử Linux. Cấu hình 96 khung giữ chi phí bộ nhớ thấp hơn và dùng chung ONNX Runtime cho Android và web. [Demucs v4](https://github.com/facebookresearch/demucs) · [Các tùy chọn MDX-Net](https://github.com/k2-fsa/sherpa-onnx/releases/tag/source-separation-models)

Có thể đối chiếu lại các tệp đã xuất cùng stem tham chiếu bằng `python tools/score-separation.py instrumental.wav vocal.wav before.wav after.wav`. Cần `numpy`, `ffmpeg` và các đoạn bắt đầu ở cùng vị trí. Âm thanh tham chiếu được lưu riêng khỏi repository.

## Kiểm thử

`node --test tests/audio.test.cjs` kiểm tra khôi phục PCM qua STFT/iSTFT, hủy xử lý và các tính năng hợp âm hiện có. `python tests/model_test.py` chạy suy luận với ONNX Runtime 1.22.0.

Để chạy kiểm thử giao diện, phục vụ thư mục gốc bằng `python -m http.server 8000` sau khi cài Chromium và Python Playwright. `python tests/browser_test.py http://localhost:8000` kiểm tra metadata và chức năng cũ. `python tests/separator_browser_test.py http://localhost:8000 mix.wav mix.mp3` kiểm tra luồng tách thực với hai bản stereo dài ít nhất 10 giây và cần thêm `ffmpeg`.

Để chạy phép đo hợp âm và cao độ bằng bản thu GuitarSet có nhãn, cài `remotezip` và `ffmpeg`, tải dữ liệu bằng `python tests/fetch_guitarset.py /tmp/guitarset`, rồi chạy `CHORD_FIXTURES=/tmp/guitarset node --test tests/audio.test.cjs`. [GuitarSet, CC BY 4.0](https://doi.org/10.5281/zenodo.3371780)

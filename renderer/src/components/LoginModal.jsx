import React from 'react';
import { Modal } from 'animal-island-ui';

export default function LoginModal({ open, onClose }) {
  return (
    <Modal
      open={open}
      title="QQ 扫码登录"
      onClose={onClose}
      footer={null}
      maskClosable={false}
      typewriter={false}
      width={400}
    >
      <div style={{ textAlign: 'center', padding: '10px 0' }}>
        <p>已打开浏览器窗口，请在其中完成 QQ 扫码登录。</p>
        <p style={{ marginTop: 8, opacity: 0.7 }}>登录成功后窗口将自动关闭。</p>
      </div>
    </Modal>
  );
}

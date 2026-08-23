import { Resend } from "resend";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM;

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

// Sem as credenciais configuradas (ex.: alguém subindo o projeto localmente
// sem ter criado uma conta no Resend ainda), a recuperação de senha só
// loga o link no console em vez de falhar — dá pra testar o fluxo mesmo sem
// e-mail configurado.
export async function enviarEmailRedefinicaoSenha(destinatario: string, link: string) {
  if (!resend || !EMAIL_FROM) {
    console.warn(
      `[email] RESEND_API_KEY/EMAIL_FROM não configurados — link de redefinição para ${destinatario}: ${link}`
    );
    return;
  }

  await resend.emails.send({
    from: EMAIL_FROM,
    to: destinatario,
    subject: "Redefinição de senha — NotePlus+",
    text: `Recebemos uma solicitação para redefinir sua senha. Acesse o link para continuar (válido por 1 hora): ${link}\n\nSe você não pediu isso, pode ignorar este e-mail.`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #05AE76;">Redefinição de senha</h2>
        <p>Recebemos uma solicitação para redefinir a senha da sua conta no NotePlus+.</p>
        <p>
          <a href="${link}" style="display: inline-block; background: #05AE76; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold;">
            Redefinir senha
          </a>
        </p>
        <p style="color: #666; font-size: 13px;">Esse link é válido por 1 hora. Se você não pediu essa redefinição, pode ignorar este e-mail com segurança.</p>
      </div>
    `,
  });
}

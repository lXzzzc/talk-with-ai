package org.xzzz.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * 跨域配置。
 *
 * <p>这里踩过两个坑，改动时注意：
 * <ul>
 *   <li>类上必须是 {@code @Configuration}。原先写的是 {@code @RequestMapping}，导致这个类
 *       <b>根本不是 Spring Bean</b>，{@code addCorsMappings} 从未被调用过，CORS 配置实际是失效的；
 *       开发时因为走 Vite 代理属于同源，所以一直没暴露。</li>
 *   <li>应用当前没有 Cookie/HTTP 登录态，因此保持 {@code allowCredentials(false)}；
 *       后续若接入认证，应同时把允许来源收紧到可信域名。</li>
 * </ul>
 *
 * <p>生产环境若由 Nginx 同域托管前端并反代 {@code /api}，本身不需要跨域，可通过
 * {@code app.cors.allowed-origins} 把来源收紧到具体域名（逗号分隔）。
 */
@Configuration
public class MvcConfiguration implements WebMvcConfigurer {

    @Value("${app.cors.allowed-origins:*}")
    private String[] allowedOrigins;

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/**")
                .allowedOriginPatterns(allowedOrigins)
                .allowedMethods("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
                // 当前应用不使用 Cookie/HTTP 认证信息，禁止跨域携带凭据可避免未来接入
                // 登录后被宽泛的 Origin 配置意外放大攻击面。
                .allowCredentials(false)
                .allowedHeaders("*");
    }
}
